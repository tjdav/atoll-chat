import { createPlugin } from 'coralite'
import PocketBase from 'pocketbase'
import { openDB } from 'idb'

/**
 *
 */
export default function (pluginOptions) {
  return createPlugin({
    name: 'pocketbase-plugin',
    client: {
      imports: [
        {
          specifier: 'pocketbase',
          defaultExport: 'PocketBase'
        },
        {
          specifier: 'idb',
          namedExports: ['openDB']
        }
      ],
      setup (context) {
        const baseUrl = pluginOptions?.baseUrl || 'http://localhost:8090'
        const pb = new PocketBase(baseUrl)

        let dbPromise = null

        const initDB = async () => {
          if (!dbPromise) {
            dbPromise = openDB('atoll-crypto-store', 1, {
              upgrade (db) {
                if (!db.objectStoreNames.contains('private_keys')) {
                  db.createObjectStore('private_keys')
                }
                if (!db.objectStoreNames.contains('room_keys')) {
                  db.createObjectStore('room_keys')
                }
                if (!db.objectStoreNames.contains('decrypted_messages')) {
                  db.createObjectStore('decrypted_messages')
                }
                if (!db.objectStoreNames.contains('sync_cursors')) {
                  db.createObjectStore('sync_cursors')
                }
              }
            })
          }
          return dbPromise
        }

        // Web Crypto API helpers
        const deriveKeyFromPassword = async (password, salt) => {
          const enc = new TextEncoder()
          const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            enc.encode(password),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
          )
          return window.crypto.subtle.deriveKey(
            {
              name: 'PBKDF2',
              salt: salt,
              iterations: 100000,
              hash: 'SHA-256'
            },
            keyMaterial,
            {
              name: 'AES-GCM',
              length: 256
            },
            false,
            ['encrypt', 'decrypt']
          )
        }

        const generateECDHKeyPair = async () => {
          return window.crypto.subtle.generateKey(
            {
              name: 'ECDH',
              namedCurve: 'P-256'
            },
            true,
            ['deriveKey', 'deriveBits']
          )
        }

        const generateAESGCMKey = async () => {
          return window.crypto.subtle.generateKey(
            {
              name: 'AES-GCM',
              length: 256
            },
            true,
            ['encrypt', 'decrypt']
          )
        }

        const exportPublicKey = async (key) => {
          const exported = await window.crypto.subtle.exportKey('jwk', key)
          return exported
        }

        const importPublicKey = async (jwk) => {
          return window.crypto.subtle.importKey(
            'jwk',
            jwk,
            {
              name: 'ECDH',
              namedCurve: 'P-256'
            },
            true,
            []
          )
        }

        const encryptPrivateKey = async (privateKey, passwordKey) => {
          const jwk = await window.crypto.subtle.exportKey('jwk', privateKey)
          const enc = new TextEncoder()
          const data = enc.encode(JSON.stringify(jwk))
          const iv = window.crypto.getRandomValues(new Uint8Array(12))
          const ciphertext = await window.crypto.subtle.encrypt(
            {
              name: 'AES-GCM',
              iv: iv
            },
            passwordKey,
            data
          )
          return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(ciphertext))
          }
        }

        const decryptPrivateKey = async (encryptedData, passwordKey) => {
          const iv = new Uint8Array(encryptedData.iv)
          const ciphertext = new Uint8Array(encryptedData.ciphertext)
          const decrypted = await window.crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: iv
            },
            passwordKey,
            ciphertext
          )
          const dec = new TextDecoder()
          const jwk = JSON.parse(dec.decode(decrypted))
          return window.crypto.subtle.importKey(
            'jwk',
            jwk,
            {
              name: 'ECDH',
              namedCurve: 'P-256'
            },
            true,
            ['deriveKey', 'deriveBits']
          )
        }

        const login = async (credentials) => {
          const { username, password } = credentials
          const authData = await pb.collection('users').authWithPassword(username, password)

          // Return so the app can prompt for password locally to decrypt IndexedDB keys
          return authData
        }

        const registerUser = async ({ username, password, displayName }) => {
        // Generate Keys First
          const ecdhKeyPair = await generateECDHKeyPair()
          const publicKeyJwk = await exportPublicKey(ecdhKeyPair.publicKey)

          // Create user record
          const record = await pb.collection('users').create({
            username,
            password,
            passwordConfirm: password,
            displayName: displayName || username,
            public_key: JSON.stringify(publicKeyJwk)
          })

          // Authenticate immediately to get token
          await pb.collection('users').authWithPassword(username, password)

          // Derive password key and encrypt private key
          const salt = window.crypto.getRandomValues(new Uint8Array(16))
          const passwordKey = await deriveKeyFromPassword(password, salt)
          const encryptedPrivateKey = await encryptPrivateKey(ecdhKeyPair.privateKey, passwordKey)

          // Save encrypted private key and salt to indexedDB
          const db = await initDB()
          await db.put('private_keys', {
            encrypted: encryptedPrivateKey,
            salt: Array.from(salt)
          }, record.id)

          return record
        }

        const restoreSession = async () => {
          pb.authStore.loadFromCookie(document.cookie)
          if (pb.authStore.isValid) {
            try {
              await pb.collection('users').authRefresh()
              return true
            } catch (error) {
              pb.authStore.clear()
              return false
            }
          }
          return false
        }

        const logout = async () => {
          pb.authStore.clear()
          document.cookie = pb.authStore.exportToCookie({ httpOnly: false })
        }

        const wrapKey = async (roomKey, recipientPublicKeyJwk, senderPrivateKey) => {
          const recipientPublicKey = await importPublicKey(recipientPublicKeyJwk)
          const sharedSecret = await window.crypto.subtle.deriveKey(
            {
              name: 'ECDH',
              public: recipientPublicKey
            },
            senderPrivateKey,
            {
              name: 'AES-GCM',
              length: 256
            },
            false,
            ['encrypt']
          )
          const rawRoomKey = await window.crypto.subtle.exportKey('raw', roomKey)
          const iv = window.crypto.getRandomValues(new Uint8Array(12))
          const encryptedKey = await window.crypto.subtle.encrypt(
            {
              name: 'AES-GCM',
              iv: iv
            },
            sharedSecret,
            rawRoomKey
          )
          return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(encryptedKey))
          }
        }

        const unwrapKey = async (wrappedKeyData, senderPublicKeyJwk, recipientPrivateKey) => {
          const senderPublicKey = await importPublicKey(senderPublicKeyJwk)
          const sharedSecret = await window.crypto.subtle.deriveKey(
            {
              name: 'ECDH',
              public: senderPublicKey
            },
            recipientPrivateKey,
            {
              name: 'AES-GCM',
              length: 256
            },
            false,
            ['decrypt']
          )
          const iv = new Uint8Array(wrappedKeyData.iv)
          const ciphertext = new Uint8Array(wrappedKeyData.ciphertext)
          const rawRoomKey = await window.crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: iv
            },
            sharedSecret,
            ciphertext
          )
          return window.crypto.subtle.importKey(
            'raw',
            rawRoomKey,
            {
              name: 'AES-GCM',
              length: 256
            },
            true,
            ['encrypt', 'decrypt']
          )
        }

        const createRoom = async ({ name, topic, invites, senderPrivateKey }) => {
          const room = await pb.collection('rooms').create({
            name,
            topic
          })

          const roomKey = await generateAESGCMKey()
          const currentUser = pb.authStore.model
          const usersToInvite = [...invites, currentUser]

          for (const user of usersToInvite) {
            const userRecord = await pb.collection('users').getOne(user.id)
            const wrappedKey = await wrapKey(roomKey, JSON.parse(userRecord.public_key), senderPrivateKey)

            await pb.collection('room_members').create({
              room_id: room.id,
              user_id: userRecord.id,
              status: user.id === currentUser.id ? 'joined' : 'invited',
              encrypted_room_key: JSON.stringify(wrappedKey)
            })
          }

          return room
        }

        const encryptMessage = async (payload, roomKey) => {
          const enc = new TextEncoder()
          const iv = window.crypto.getRandomValues(new Uint8Array(12))
          const ciphertext = await window.crypto.subtle.encrypt(
            {
              name: 'AES-GCM',
              iv: iv
            },
            roomKey,
            enc.encode(payload)
          )
          return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(ciphertext))
          }
        }

        const decryptMessage = async (encryptedPayloadData, roomKey) => {
          const iv = new Uint8Array(encryptedPayloadData.iv)
          const ciphertext = new Uint8Array(encryptedPayloadData.ciphertext)
          const decrypted = await window.crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: iv
            },
            roomKey,
            ciphertext
          )
          const dec = new TextDecoder()
          return dec.decode(decrypted)
        }

        const sendMessage = async ({ roomId, msgtype, payload, roomKey }) => {
          const encryptedPayload = await encryptMessage(payload, roomKey)
          const senderId = pb.authStore.model.id

          const messageRecord = await pb.collection('messages').create({
            room_id: roomId,
            sender_id: senderId,
            msgtype,
            payload: JSON.stringify(encryptedPayload)
          })

          return messageRecord
        }

        const sendTorrentMessage = async ({ roomId, magnetURI, fileInfo, roomKey }) => {
          const payload = JSON.stringify({
            magnetURI,
            filename: fileInfo.filename,
            size: fileInfo.size,
            mimeType: fileInfo.mimeType,
            key: fileInfo.key,
            iv: fileInfo.iv
          })

          return await sendMessage({
            roomId,
            msgtype: 'webtorrent',
            payload,
            roomKey
          })
        }

        const rotateRoomKey = async ({ roomId, senderPrivateKey }) => {
          const members = await pb.collection('room_members').getFullList({
            filter: `room_id = "${roomId}" && status != "left"`
          })

          const newRoomKey = await generateAESGCMKey()

          for (const member of members) {
            const userRecord = await pb.collection('users').getOne(member.user_id)
            const wrappedKey = await wrapKey(newRoomKey, JSON.parse(userRecord.public_key), senderPrivateKey)

            await pb.collection('room_members').update(member.id, {
              encrypted_room_key: JSON.stringify(wrappedKey)
            })
          }
        }

        const getRooms = async () => {
          if (!pb.authStore.isValid) {
            return []
          }
          const userId = pb.authStore.model.id
          const members = await pb.collection('room_members').getFullList({
            filter: `user_id = "${userId}"`,
            expand: 'room_id'
          })
          return members.map(m => m.expand.room_id)
        }

        const sync = async () => {
        // Stub for UI compatibility (Matrix plugin had a sync function)
          return Promise.resolve()
        }

        const isUserTrusted = async (userId) => {
          if (!pb.authStore.isValid) {
            return false
          }
          const currentUserId = pb.authStore.model.id
          try {
            const trustRecords = await pb.collection('trusted_contacts').getList(1, 1, {
              filter: `owner_id = "${currentUserId}" && trusted_user_id = "${userId}"`
            })
            return trustRecords.items.length > 0
          } catch (error) {
            return false
          }
        }

        const trustUser = async (userId) => {
          const currentUserId = pb.authStore.model.id
          await pb.collection('trusted_contacts').create({
            owner_id: currentUserId,
            trusted_user_id: userId
          })
        }

        const getRoomMessages = async (roomId) => {
          const messages = await pb.collection('messages').getList(1, 50, {
            filter: `room_id = "${roomId}"`,
            sort: '-created',
            expand: 'sender_id'
          })
          return messages.items.reverse()
        }

        const onRoomMessage = (roomId, callback) => {
          return pb.collection('messages').subscribe('*', function (event) {
            if (event.action === 'create' && event.record.room_id === roomId) {
              callback(event.record)
            }
          })
        }

        const unsubscribeRoomMessages = () => {
          return pb.collection('messages').unsubscribe('*')
        }

        return {
          pb,
          initDB,
          deriveKeyFromPassword,
          generateECDHKeyPair,
          generateAESGCMKey,
          exportPublicKey,
          importPublicKey,
          encryptPrivateKey,
          decryptPrivateKey,
          login,
          registerUser,
          restoreSession,
          logout,
          wrapKey,
          unwrapKey,
          createRoom,
          encryptMessage,
          decryptMessage,
          sendMessage,
          sendTorrentMessage,
          rotateRoomKey,
          getRooms,
          getRoomMessages,
          onRoomMessage,
          unsubscribeRoomMessages,
          sync,
          isUserTrusted,
          trustUser
        }
      },
      helpers: {
        getPb: (globalContext) => () => globalContext.values.pb,
        getCryptoStore: (globalContext) => () => globalContext.values.initDB(),
        sync: (globalContext) => () => async () => globalContext.values.sync(),
        login: (globalContext) => () => async (credentials) => globalContext.values.login(credentials),
        registerUser: (globalContext) => () => async (data) => globalContext.values.registerUser(data),
        restoreSession: (globalContext) => () => async () => globalContext.values.restoreSession(),
        logout: (globalContext) => () => async () => globalContext.values.logout(),
        getRooms: (globalContext) => () => async () => globalContext.values.getRooms(),
        createRoom: (globalContext) => () => async (options) => globalContext.values.createRoom(options),
        sendMessage: (globalContext) => () => async (options) => globalContext.values.sendMessage(options),
        sendTorrentMessage: (globalContext) => () => async (options) => globalContext.values.sendTorrentMessage(options),
        rotateRoomKey: (globalContext) => () => async (options) => globalContext.values.rotateRoomKey(options),
        getRoomMessages: (globalContext) => () => async (roomId) => globalContext.values.getRoomMessages(roomId),
        onRoomMessage: (globalContext) => () => (roomId, callback) => globalContext.values.onRoomMessage(roomId, callback),
        unsubscribeRoomMessages: (globalContext) => () => () => globalContext.values.unsubscribeRoomMessages(),
        isUserTrusted: (globalContext) => () => async (userId) => globalContext.values.isUserTrusted(userId),
        trustUser: (globalContext) => () => async (userId) => globalContext.values.trustUser(userId),
        getDefaultHomeserverUrl: () => () => 'http://localhost:8090',
        cryptoHelpers: (globalContext) => () => {
          return {
            deriveKeyFromPassword: globalContext.values.deriveKeyFromPassword,
            generateECDHKeyPair: globalContext.values.generateECDHKeyPair,
            generateAESGCMKey: globalContext.values.generateAESGCMKey,
            exportPublicKey: globalContext.values.exportPublicKey,
            importPublicKey: globalContext.values.importPublicKey,
            encryptPrivateKey: globalContext.values.encryptPrivateKey,
            decryptPrivateKey: globalContext.values.decryptPrivateKey
          }
        }
      }
    }
  })
}
