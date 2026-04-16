import { definePlugin } from 'coralite'
import PocketBase from 'pocketbase'
import { openDB } from 'idb'

/**
 *
 */
export default function (pluginOptions) {
  return definePlugin({
    name: 'pocketbase-plugin',
    client: {
      config: {
        baseUrl: pluginOptions?.baseUrl || 'http://localhost:8090'
      },
      imports: [
        {
          specifier: 'pocketbase',
          defaultExport: 'PocketBase'
        },
        {
          specifier: 'idb',
          namedExports: ['openDB']
        },
        {
          specifier: 'libsodium-wrappers',
          defaultExport: 'sodium'
        }
      ],
      async setup (context) {
        const { sodium } = context.imports
        await sodium.ready

        const baseUrl = context.config.baseUrl
        const pb = new PocketBase(baseUrl)

        let dbPromise = null

        // THE SECURE VAULT
        // This lives purely in RAM. It is wiped when the tab closes.
        let activeSessionKeys = null

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
              }
            })
          }
          return dbPromise
        }

        const login = async (credentials) => {
          const { username, password } = credentials
          const authData = await pb.collection('users').authWithPassword(username, password)

          // Return so the app can prompt for password locally to decrypt IndexedDB keys
          return authData
        }

        const registerUser = async ({ username, password, displayName }) => {
          // This will be rewritten to use Libsodium ZK flow
          throw new Error('Not implemented')
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

        const getCurrentUserId = () => {
          return pb.authStore.record?.id
        }

        const getAuthStore = () => {
          return pb.authStore
        }

        // --- Libsodium Key Generation Helpers ---

        const generateMasterKeys = () => {
          const encryptionKeyPair = sodium.crypto_box_keypair()
          const identityKeyPair = sodium.crypto_sign_keypair()

          return {
            encryptionKeyPair,
            identityKeyPair
          }
        }

        const _generateBackupCode = () => {
          // Generate 16 secure random bytes and encode to hex for the backup code string
          const bytes = sodium.randombytes_buf(16)
          return sodium.to_hex(bytes)
        }

        const _derivePinKEK = (pin, saltHex) => {
          const saltBytes = sodium.from_hex(saltHex)
          // Argon2id
          return sodium.crypto_pwhash(
            sodium.crypto_secretbox_KEYBYTES,
            pin,
            saltBytes,
            sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_ALG_ARGON2ID13
          )
        }

        const _deriveBackupKEK = (backupCode) => {
          // A static salt for backup KEK derivation is acceptable since the backup code is highly entropic and randomly generated.
          const backupSalt = sodium.from_hex('00000000000000000000000000000000')
          return sodium.crypto_pwhash(
            sodium.crypto_secretbox_KEYBYTES,
            backupCode,
            backupSalt,
            sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_ALG_ARGON2ID13
          )
        }

        const initializeAuth = async () => {
          if (!window.PublicKeyCredential || !window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
            return { status: 'REQUIRES_PIN' }
          }

          const isAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          if (!isAvailable) {
            return { status: 'REQUIRES_PIN' }
          }


          return { status: 'AUTHENTICATED' }
        }

        const registerWithPasskey = async ({ username, password, displayName, pin }) => {
          const keys = generateMasterKeys()

          const publicBoxKey = sodium.to_base64(keys.encryptionKeyPair.publicKey, sodium.base64_variants.ORIGINAL)
          const publicSignKey = sodium.to_base64(keys.identityKeyPair.publicKey, sodium.base64_variants.ORIGINAL)

          const backupCode = _generateBackupCode()
          const backupKEK = _deriveBackupKEK(backupCode)

          const privateKeysBlob = JSON.stringify({
            box: sodium.to_base64(keys.encryptionKeyPair.privateKey, sodium.base64_variants.ORIGINAL),
            sign: sodium.to_base64(keys.identityKeyPair.privateKey, sodium.base64_variants.ORIGINAL)
          })

          const backupNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
          const encryptedBackupBlob = sodium.crypto_secretbox_easy(privateKeysBlob, backupNonce, backupKEK)

          let encryptedPinBlob = null
          let pinNonceHex = null
          const pinSalt = sodium.to_hex(sodium.randombytes_buf(16))
          if (pin) {
            const pinKEK = _derivePinKEK(pin, pinSalt)
            const pinNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
            encryptedPinBlob = sodium.crypto_secretbox_easy(privateKeysBlob, pinNonce, pinKEK)
            pinNonceHex = sodium.to_hex(pinNonce)
          }

          let passkeyCredentialId = ''
          let encryptedPrfBlob = null
          let prfNonceHex = null

          if (window.PublicKeyCredential) {
            try {
              const prfSalt = window.crypto.getRandomValues(new Uint8Array(32))
              const credential = await navigator.credentials.create({
                publicKey: {
                  challenge: window.crypto.getRandomValues(new Uint8Array(32)),
                  rp: {
                    name: 'Atoll Local',
                    id: window.location.hostname
                  },
                  user: {
                    id: window.crypto.getRandomValues(new Uint8Array(16)),
                    name: username,
                    displayName: displayName || username
                  },
                  pubKeyCredParams: [{
                    type: 'public-key',
                    alg: -7
                  }, {
                    type: 'public-key',
                    alg: -257
                  }],
                  authenticatorSelection: {
                    userVerification: 'required',
                    residentKey: 'required'
                  },
                  extensions: {
                    prf: {
                      eval: {
                        first: prfSalt
                      }
                    }
                  }
                }
              })

              const extResults = credential.getClientExtensionResults()
              if (extResults.prf && extResults.prf.enabled && extResults.prf.results && extResults.prf.results.first) {
                passkeyCredentialId = sodium.to_base64(new Uint8Array(credential.rawId), sodium.base64_variants.ORIGINAL)
                const prfKEK = new Uint8Array(extResults.prf.results.first)

                const prfNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
                const ciphertext = sodium.crypto_secretbox_easy(privateKeysBlob, prfNonce, prfKEK)
                encryptedPrfBlob = sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL)
                prfNonceHex = sodium.to_hex(prfNonce)
              }
            } catch (error) {
              console.warn('Passkey creation with PRF failed or was cancelled, falling back to PIN/Backup only.', error)
            }
          }

          const encryptedMasterKeys = {
            backup: {
              nonce: sodium.to_hex(backupNonce),
              ciphertext: sodium.to_base64(encryptedBackupBlob, sodium.base64_variants.ORIGINAL)
            }
          }

          if (encryptedPinBlob) {
            encryptedMasterKeys.pin = {
              nonce: pinNonceHex,
              ciphertext: sodium.to_base64(encryptedPinBlob, sodium.base64_variants.ORIGINAL)
            }
          }

          if (encryptedPrfBlob) {
            encryptedMasterKeys.prf = {
              nonce: prfNonceHex,
              ciphertext: encryptedPrfBlob
            }
          }

          // Create User in Pocketbase
          const record = await pb.collection('users').create({
            username,
            password,
            passwordConfirm: password,
            displayName: displayName || username,
            public_box_key: publicBoxKey,
            public_sign_key: publicSignKey,
            encrypted_master_keys: encryptedMasterKeys,
            pin_salt: pinSalt,
            passkey_credential_id: passkeyCredentialId
          })

          await pb.collection('users').authWithPassword(username, password)

          // Save decrypted keys to activeSessionKeys securely in RAM
          activeSessionKeys = {
            encryptionPrivateKey: keys.encryptionKeyPair.privateKey,
            identityPrivateKey: keys.identityKeyPair.privateKey
          }

          // We can optionally store the encrypted blobs to IDB to prevent fetching next load
          const db = await initDB()
          await db.put('private_keys', {
            encrypted_master_keys: encryptedMasterKeys,
            pin_salt: pinSalt
          }, record.id)

          return {
            success: true,
            backupCode
          }
        }

        const unlockWithPin = async (pin) => {
          if (!pb.authStore.isValid) {
            throw new Error('Not authenticated with Pocketbase')
          }

          const userId = pb.authStore.model.id

          let encryptedMasterKeys, pinSalt

          // Fetch from IDB Cache first, fallback to PB network
          const db = await initDB()
          const cachedUser = await db.get('private_keys', userId)
          if (cachedUser && cachedUser.encrypted_master_keys) {
            encryptedMasterKeys = cachedUser.encrypted_master_keys
            pinSalt = cachedUser.pin_salt
          } else {
            const user = await pb.collection('users').getOne(userId)
            encryptedMasterKeys = user.encrypted_master_keys
            pinSalt = user.pin_salt
          }

          if (!encryptedMasterKeys || !encryptedMasterKeys.pin) {
            throw new Error('No PIN configured for this user')
          }

          const pinKEK = _derivePinKEK(pin, pinSalt)
          const nonce = sodium.from_hex(encryptedMasterKeys.pin.nonce)
          const ciphertext = sodium.from_base64(encryptedMasterKeys.pin.ciphertext, sodium.base64_variants.ORIGINAL)

          try {
            const decryptedBlobStr = sodium.crypto_secretbox_open_easy(ciphertext, nonce, pinKEK)
            const decryptedBlob = JSON.parse(sodium.to_string(decryptedBlobStr))

            const boxPriv = sodium.from_base64(decryptedBlob.box, sodium.base64_variants.ORIGINAL)
            const signPriv = sodium.from_base64(decryptedBlob.sign, sodium.base64_variants.ORIGINAL)

            activeSessionKeys = {
              encryptionPrivateKey: boxPriv,
              identityPrivateKey: signPriv
            }

            return { success: true }
          } catch (error) {
            throw new Error('Invalid PIN')
          }
        }

        const createRoom = async ({ name, topic, invites }) => {
          if (!activeSessionKeys) {
            throw new Error('App is locked. Keys not in memory.')
          }
          const room = await pb.collection('rooms').create({
            name,
            topic
          })

          const roomKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES)

          const currentUser = pb.authStore.model
          const usersToInvite = [...invites, currentUser]

          const db = await initDB()

          // Create default roles for the room
          const [ownerRole, adminRole, modRole, memberRole] = await Promise.all([
            pb.collection('room_roles').create({ room_id: room.id, name: 'Owner' }),
            pb.collection('room_roles').create({ room_id: room.id, name: 'Administrator' }),
            pb.collection('room_roles').create({ room_id: room.id, name: 'Moderator' }),
            pb.collection('room_roles').create({ room_id: room.id, name: 'Member' })
          ])

          for (const user of usersToInvite) {
            let userRecord
            if (user.id === currentUser.id) {
              userRecord = currentUser
            } else {
              userRecord = await pb.collection('users').getOne(user.id)
            }

            const recipientBoxPub = sodium.from_base64(userRecord.public_box_key, sodium.base64_variants.ORIGINAL)
            const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES)
            const encryptedRoomKey = sodium.crypto_box_easy(roomKey, nonce, recipientBoxPub, activeSessionKeys.encryptionPrivateKey)

            const combined = new Uint8Array(nonce.length + encryptedRoomKey.length)
            combined.set(nonce)
            combined.set(encryptedRoomKey, nonce.length)

            await pb.collection('room_members').create({
              room_id: room.id,
              user_id: userRecord.id,
              invited_by: currentUser.id,
              status: user.id === currentUser.id ? 'joined' : 'invited',
              encrypted_room_key: sodium.to_base64(combined, sodium.base64_variants.ORIGINAL)
            })

            // Assign role
            const roleToAssign = user.id === currentUser.id ? ownerRole : memberRole
            await pb.collection('room_user_roles').create({
              room_id: room.id,
              user_id: userRecord.id,
              role_id: roleToAssign.id
            })
          }

          // Cache our own decrypted room key
          await db.put('room_keys', roomKey, room.id)

          return room
        }

        const encryptMessage = async (payload, roomKey) => {
          const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)

          const framedPayload = JSON.stringify({
            data: payload,
            timestamp: Date.now(),
            msg_id: crypto.randomUUID()
          })

          const signature = sodium.crypto_sign_detached(framedPayload, activeSessionKeys.identityPrivateKey)
          
          const signedPayload = new Uint8Array(signature.length + sodium.from_string(framedPayload).length)
          signedPayload.set(signature)
          signedPayload.set(sodium.from_string(framedPayload), signature.length)

          const ciphertext = sodium.crypto_secretbox_easy(signedPayload, nonce, roomKey)

          // Prepend nonce to ciphertext
          const combined = new Uint8Array(nonce.length + ciphertext.length)
          combined.set(nonce)
          combined.set(ciphertext, nonce.length)

          return sodium.to_base64(combined, sodium.base64_variants.ORIGINAL)
        }

        const decryptMessage = async (encryptedPayloadBase64, roomKey, senderPublicSignKey, lastTimestamp = 0) => {
          try {
            const combined = sodium.from_base64(encryptedPayloadBase64, sodium.base64_variants.ORIGINAL)

            if (combined.length < sodium.crypto_secretbox_NONCEBYTES + sodium.crypto_secretbox_MACBYTES) {
              return {
                type: 'tombstone',
                reason: 'INVALID_PAYLOAD'
              }
            }

            const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES)
            const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES)

            const decryptedBytes = sodium.crypto_secretbox_open_easy(ciphertext, nonce, roomKey)
            
            if (decryptedBytes.length < sodium.crypto_sign_BYTES) {
               return {
                  type: 'tombstone',
                  reason: 'INVALID_PAYLOAD'
               }
            }

            const signature = decryptedBytes.slice(0, sodium.crypto_sign_BYTES)
            const payloadBytes = decryptedBytes.slice(sodium.crypto_sign_BYTES)
            const payloadStr = sodium.to_string(payloadBytes)

            if (!senderPublicSignKey) {
              return {
                type: 'tombstone',
                reason: 'MISSING_SENDER_KEY'
              }
            }

            const senderSignKeyBytes = sodium.from_base64(senderPublicSignKey, sodium.base64_variants.ORIGINAL)
            const isValid = sodium.crypto_sign_verify_detached(signature, payloadStr, senderSignKeyBytes)

            if (!isValid) {
              return {
                type: 'tombstone',
                reason: 'SIGNATURE_MISMATCH'
              }
            }

            const framedPayload = JSON.parse(payloadStr)

            const db = await initDB()
            const exists = await db.get('decrypted_messages', framedPayload.msg_id)
            if (exists) {
              return {
                type: 'tombstone',
                reason: 'REPLAY_DETECTED'
              }
            }
            
            await db.put('decrypted_messages', true, framedPayload.msg_id)

            return {
              payload: framedPayload.data,
              timestamp: framedPayload.timestamp,
              msg_id: framedPayload.msg_id
            }
          } catch (error) {
            return {
              type: 'tombstone',
              reason: 'KEY_MISMATCH'
            }
          }
        }

        const _getOrFetchRoomKey = async (roomId) => {
          const db = await initDB()
          let roomKey = await db.get('room_keys', roomId)
          if (roomKey) {
            return roomKey
          }

          if (!activeSessionKeys) {
            throw new Error('App is locked. Keys not in memory.')
          }
          const currentUser = pb.authStore.model
          const memberRecord = await pb.collection('room_members').getFirstListItem(`room_id="${roomId}" && user_id="${currentUser.id}"`, {
            expand: 'invited_by'
          })

          if (!memberRecord || !memberRecord.encrypted_room_key) {
            throw new Error('No room key found')
          }

          if (!memberRecord.expand || !memberRecord.expand.invited_by || !memberRecord.expand.invited_by.public_box_key) {
            throw new Error('Inviter information is missing')
          }

          const combined = sodium.from_base64(memberRecord.encrypted_room_key, sodium.base64_variants.ORIGINAL)
          const nonce = combined.slice(0, sodium.crypto_box_NONCEBYTES)
          const ciphertext = combined.slice(sodium.crypto_box_NONCEBYTES)

          let decryptedRoomKey = null

          try {
            const senderPub = sodium.from_base64(memberRecord.expand.invited_by.public_box_key, sodium.base64_variants.ORIGINAL)
            decryptedRoomKey = sodium.crypto_box_open_easy(ciphertext, nonce, senderPub, activeSessionKeys.encryptionPrivateKey)
          } catch (error) {
            throw new Error('Failed to decrypt room key')
          }

          if (!decryptedRoomKey) {
            throw new Error('Failed to decrypt room key from the inviter')
          }

          await db.put('room_keys', decryptedRoomKey, roomId)
          return decryptedRoomKey
        }

        const sendMessage = async ({ roomId, msgtype, payload }) => {
          const roomKey = await _getOrFetchRoomKey(roomId)
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

        const sendTorrentMessage = async ({ roomId, magnetURI, fileInfo }) => {
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
            payload
          })
        }

        const rotateRoomKey = async ({ roomId }) => {
          throw new Error('Not implemented')
        }

        const lockApp = async () => {
          const db = await initDB()
          activeSessionKeys = null
          await db.clear('private_keys')
          await db.clear('room_keys')
          pb.authStore.clear()
          document.cookie = pb.authStore.exportToCookie({ httpOnly: false })
          return true
        }

        const isVaultUnlocked = () => {
          return activeSessionKeys !== null
        }

        const revokeDevices = async (pin) => {
          if (!pb.authStore.isValid) {
            throw new Error('Not logged in')
          }
          if (!activeSessionKeys) {
            throw new Error('Keys locked')
          }
          if (!pin) {
            throw new Error('PIN is required to re-encrypt the vault during device revocation.')
          }

          const currentUser = await pb.collection('users').getOne(pb.authStore.model.id)
          const db = await initDB()

          const newBoxKeys = sodium.crypto_box_keypair()
          const publicBoxKey = sodium.to_base64(newBoxKeys.publicKey, sodium.base64_variants.ORIGINAL)

          // We are generating a new backup code here as well, because the vault contents change.
          const backupCode = _generateBackupCode()
          const backupKEK = _deriveBackupKEK(backupCode)

          const privateKeysBlob = JSON.stringify({
            box: sodium.to_base64(newBoxKeys.privateKey, sodium.base64_variants.ORIGINAL),
            sign: sodium.to_base64(activeSessionKeys.identityPrivateKey, sodium.base64_variants.ORIGINAL)
          })

          const backupNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
          const encryptedBackupBlob = sodium.crypto_secretbox_easy(privateKeysBlob, backupNonce, backupKEK)

          const pinKEK = _derivePinKEK(pin, currentUser.pin_salt)
          const pinNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
          const encryptedPinBlob = sodium.crypto_secretbox_easy(privateKeysBlob, pinNonce, pinKEK)

          // If they used PRF, they would need to tap their authenticator again to get the KEK.
          // In this limited PRF mockup scope, we clear the PRF array. They will have to rely on PIN until they register a new passkey.

          const encryptedMasterKeys = {
            backup: {
              nonce: sodium.to_hex(backupNonce),
              ciphertext: sodium.to_base64(encryptedBackupBlob, sodium.base64_variants.ORIGINAL)
            },
            pin: {
              nonce: sodium.to_hex(pinNonce),
              ciphertext: sodium.to_base64(encryptedPinBlob, sodium.base64_variants.ORIGINAL)
            }
          }

          // Sign the new box key with our permanent identity key to prove ownership.
          // The instructions asked to update PocketBase with this signature, so we attach it.
          // Even though we didn't add it to the migration, we can pack it into a JSON string if the field expects text, or just store the public_box_key directly.
          // Let's store just the base64 string as before, but sign the data for posterity if a client checks.
          // Due to schema limits (TextField `public_box_key`), let's encode the signature into the `encrypted_master_keys` JSON to keep it attached to the vault update.
          const sig = sodium.crypto_sign(newBoxKeys.publicKey, activeSessionKeys.identityPrivateKey)
          encryptedMasterKeys.signature = sodium.to_base64(sig, sodium.base64_variants.ORIGINAL)

          await pb.collection('users').update(currentUser.id, {
            public_box_key: publicBoxKey,
            encrypted_master_keys: encryptedMasterKeys
          })

          await lockApp()

          return {
            success: true,
            newBackupCode: backupCode
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
          // Stub for UI compatibility
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
          const roomKey = await _getOrFetchRoomKey(roomId)
          const messages = await pb.collection('messages').getList(1, 50, {
            filter: `room_id = "${roomId}"`,
            sort: '-created',
            expand: 'sender_id'
          })

          // Decrypt payloads inline or handle in UI? Better to decrypt here to simplify UI, matching original flow
          const decryptedItems = []
          for (const message of messages.items) {
            let payloadStr = message.payload
            try {
              payloadStr = JSON.parse(message.payload)
            } catch (error) {
            }

            const senderPublicSignKey = message.expand?.sender_id?.public_sign_key
            const decoded = await decryptMessage(payloadStr, roomKey, senderPublicSignKey)
            message.decryptedPayload = decoded
            decryptedItems.push(message)
          }

          return decryptedItems.reverse()
        }

        const onRoomMessage = async (roomId, callback) => {
          const roomKey = await _getOrFetchRoomKey(roomId)
          return pb.collection('messages').subscribe('*', async function (event) {
            if (event.action === 'create' && event.record.room_id === roomId) {
              let payloadStr = event.record.payload
              try {
                payloadStr = JSON.parse(event.record.payload)
              } catch (error) {
              }
              
              let senderPublicSignKey = null
              try {
                const sender = await pb.collection('users').getOne(event.record.sender_id)
                senderPublicSignKey = sender.public_sign_key
              } catch (error) {
                // Ignore error if sender user not found
              }

              const decoded = await decryptMessage(payloadStr, roomKey, senderPublicSignKey)
              event.record.decryptedPayload = decoded

              // Handle WebRTC Signaling internally
              if (event.record.msgtype === 'm.call.invite') {
                const call = {
                  roomId,
                  type: decoded.type,
                  offer: decoded.offer,
                  answer: async () => {
                    return await answerCall(roomId, decoded.offer, decoded.type)
                  },
                  reject: async () => {
                    await rejectCall(roomId)
                  }
                }
                // Dispatch to the UI
                if (globalContext.helpers && globalContext.helpers.setState) {
                  globalContext.helpers.setState('triggerCallIncoming', { call })
                }
              } else if (event.record.msgtype === 'm.call.answer' && activePeerConnection) {
                await activePeerConnection.setRemoteDescription(new RTCSessionDescription(decoded.answer))
              } else if (event.record.msgtype === 'm.call.candidates' && activePeerConnection) {
                await activePeerConnection.addIceCandidate(new RTCIceCandidate(decoded.candidate))
              } else if (event.record.msgtype === 'm.call.hangup' && activePeerConnection) {
                activePeerConnection.close()
                activePeerConnection = null
                if (globalContext.helpers && globalContext.helpers.setState) {
                  globalContext.helpers.setState('activeCall', null)
                }
              }

              callback(event.record)
            }
          })
        }

        const unsubscribeRoomMessages = () => {
          return pb.collection('messages').unsubscribe('*')
        }

        // WebRTC Signaling methods via PocketBase
        let activePeerConnection = null
        const placeCall = async (roomId, type = 'video') => {
          activePeerConnection = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          })
          activePeerConnection.roomId = roomId

          const localStream = await navigator.mediaDevices.getUserMedia({
            video: type === 'video',
            audio: true
          })
          localStream.getTracks().forEach(track => activePeerConnection.addTrack(track, localStream))
          activePeerConnection.localStream = localStream

          activePeerConnection.ontrack = event => {
            if (!activePeerConnection.remoteStream) {
              activePeerConnection.remoteStream = new MediaStream()
            }
            activePeerConnection.remoteStream.addTrack(event.track)

            // Dispatch event for UI
            const callEvent = new Event('remote_stream')
            callEvent.stream = activePeerConnection.remoteStream
            activePeerConnection.dispatchEvent(callEvent)
          }

          activePeerConnection.onicecandidate = async event => {
            if (event.candidate) {
              await sendMessage({
                roomId,
                msgtype: 'm.call.candidates',
                payload: { candidate: event.candidate.toJSON() }
              })
            }
          }

          const offer = await activePeerConnection.createOffer()
          await activePeerConnection.setLocalDescription(offer)

          await sendMessage({
            roomId,
            msgtype: 'm.call.invite',
            payload: {
              offer: offer.toJSON(),
              type
            }
          })

          return activePeerConnection
        }

        const answerCall = async (roomId, offer, type = 'video') => {
          activePeerConnection = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          })
          activePeerConnection.roomId = roomId

          const localStream = await navigator.mediaDevices.getUserMedia({
            video: type === 'video',
            audio: true
          })
          localStream.getTracks().forEach(track => activePeerConnection.addTrack(track, localStream))
          activePeerConnection.localStream = localStream

          activePeerConnection.ontrack = event => {
            if (!activePeerConnection.remoteStream) {
              activePeerConnection.remoteStream = new MediaStream()
            }
            activePeerConnection.remoteStream.addTrack(event.track)

            const callEvent = new Event('remote_stream')
            callEvent.stream = activePeerConnection.remoteStream
            activePeerConnection.dispatchEvent(callEvent)
          }

          activePeerConnection.onicecandidate = async event => {
            if (event.candidate) {
              await sendMessage({
                roomId,
                msgtype: 'm.call.candidates',
                payload: { candidate: event.candidate.toJSON() }
              })
            }
          }

          await activePeerConnection.setRemoteDescription(new RTCSessionDescription(offer))
          const answer = await activePeerConnection.createAnswer()
          await activePeerConnection.setLocalDescription(answer)

          await sendMessage({
            roomId,
            msgtype: 'm.call.answer',
            payload: { answer: answer.toJSON() }
          })

          return activePeerConnection
        }

        const rejectCall = async (roomId) => {
          if (activePeerConnection) {
            activePeerConnection.close()
            activePeerConnection = null
          }
          await sendMessage({
            roomId,
            msgtype: 'm.call.hangup',
            payload: { reason: 'rejected' }
          })
        }

        const hangupCall = async (roomId) => {
          if (activePeerConnection) {
            activePeerConnection.close()
            activePeerConnection = null
          }
          await sendMessage({
            roomId,
            msgtype: 'm.call.hangup',
            payload: { reason: 'hangup' }
          })
        }

        const getActiveCall = () => activePeerConnection

        return {
          pb,
          initDB,
          login,
          registerUser,
          restoreSession,
          logout,
          generateMasterKeys,
          initializeAuth,
          registerWithPasskey,
          unlockWithPin,
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
          trustUser,
          getCurrentUserId,
          getAuthStore,
          placeCall,
          answerCall,
          rejectCall,
          hangupCall,
          getActiveCall
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
        getCurrentUserId: (globalContext) => () => () => globalContext.values.getCurrentUserId(),
        getAuthStore: (globalContext) => () => () => globalContext.values.getAuthStore(),
        placeCall: (globalContext) => () => async (roomId, type) => globalContext.values.placeCall(roomId, type),
        answerCall: (globalContext) => () => async (roomId, offer, type) => globalContext.values.answerCall(roomId, offer, type),
        rejectCall: (globalContext) => () => async (roomId) => globalContext.values.rejectCall(roomId),
        hangupCall: (globalContext) => () => async (roomId) => globalContext.values.hangupCall(roomId),
        getActiveCall: (globalContext) => () => () => globalContext.values.getActiveCall(),
        getDefaultHomeserverUrl: () => () => 'http://localhost:8090',
        crypto: (globalContext) => () => {
          return {
            generateMasterKeys: globalContext.values.generateMasterKeys,
            initializeAuth: globalContext.values.initializeAuth,
            registerWithPasskey: globalContext.values.registerWithPasskey,
            unlockWithPin: globalContext.values.unlockWithPin,
            lockApp: globalContext.values.lockApp,
            revokeDevices: globalContext.values.revokeDevices,
            isVaultUnlocked: globalContext.values.isVaultUnlocked
          }
        }
      }
    }
  })
}
