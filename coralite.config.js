import { defineConfig } from 'coralite-scripts'
import configPlugin from './src/plugins/config-plugin.js'
import pocketbasePlugin from './src/plugins/pocketbase.js'
import eventBus from './src/plugins/event-bus.js'
import statePlugin from './src/plugins/state-plugin.js'
import storagePlugin from './src/plugins/storage-plugin.js'
import utilsPlugin from './src/plugins/utils-plugin.js'
import cryptoPlugin from './src/plugins/crypto-worker.js'
import mediaWorkerPlugin from './src/plugins/media-worker-plugin.js'
import mediaPlugin from './src/plugins/media-plugin.js'
import syncPlugin from './src/plugins/sync-plugin.js'
import webrtcPlugin from './src/plugins/web-rtc-plugin.js'
import webrtcTransferPlugin from './src/plugins/webrtc-transfer-plugin.js'
import bootstrapPlugin from './src/plugins/bootstrap.js'
import emojiPlugin from './src/plugins/emoji-picker-plugin.js'
import routerPlugin from './src/plugins/router-plugin.js'
import fusePlugin from './src/plugins/fuse-plugin.js'
import totpPlugin from './src/plugins/totp-plugin.js'
import notificationPlugin from './src/plugins/notification-plugin.js'
import serviceWorkerPlugin from './src/plugins/service-worker-plugin.js'
import biometricPlugin from './src/plugins/biometric-plugin.js'
import pushPlugin from './src/plugins/push-plugin.js'
import appLifecyclePlugin from './src/plugins/app-lifecycle-plugin.js'
import networkPlugin from './src/plugins/network-plugin.js'
import markdownPlugin from './src/plugins/markdown-plugin.js'
import deeplinkPlugin from './src/plugins/deeplink-plugin.js'
import deeplinkManifestPlugin from './src/plugins/deeplink-manifest-plugin.js'
import pkg from './package.json' with { type: 'json' }
import os from 'os'

function getLocalIpAddress () {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    if (name.includes('docker') || name.includes('br-') || name.includes('veth')) continue
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

const localIp = getLocalIpAddress()
const pocketbaseBaseUrl = process.env.ATOLL_POCKETBASE_URL || `http://${localIp}:8090`

export default defineConfig({
  public: 'public',
  plugins: [
    configPlugin({
      maxServerUploadSizeBytes: process.env.ATOLL_MAX_SERVER_UPLOAD_SIZE_BYTES ? parseInt(process.env.ATOLL_MAX_SERVER_UPLOAD_SIZE_BYTES, 10) : 26214400,
      webrtcChunkSizeBytes: 16384,
      localIceServer: process.env.LOCAL_ICE_SERVER,
      notificationSoundDebounceMs: process.env.ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS ? parseInt(process.env.ATOLL_NOTIFICATION_SOUND_DEBOUNCE_MS, 10) : 1000
    }),
    pocketbasePlugin({ baseUrl: pocketbaseBaseUrl }),
    eventBus,
    statePlugin({
      initialState: {
        isAuthenticated: false,
        isVaultUnlocked: false,
        vault: {
          isLocked: true,
          supportedStrategies: ['password']
        },
        currentUser: null,
        authView: 'login',
        currentAppView: 'chats',
        activeSelectionId: null,
        activeSelectionType: null,
        mediaVolume: 1.0,
        currentMessageText: '',
        callStatus: 'idle',
        activeCallRoomId: null,
        notificationsEnabled: true,
        messageSoundsEnabled: true,
        callSoundsEnabled: true,
        isCatchingUp: false,
        isOnline: true
      }
    }),
    storagePlugin,
    utilsPlugin,
    cryptoPlugin({ url: pocketbaseBaseUrl }),
    mediaWorkerPlugin,
    mediaPlugin,
    syncPlugin(),
    routerPlugin(),
    emojiPlugin,
    fusePlugin,
    totpPlugin,
    markdownPlugin,
    bootstrapPlugin,
    webrtcPlugin(),
    webrtcTransferPlugin,
    notificationPlugin,
    biometricPlugin,
    pushPlugin({
      vapidKey: process.env.ATOLL_VAPID_PUBLIC_KEY || 'BG6jbL6oHXUyR8hntptF57uh1ZC229JFqe0t4moskBqFNFhN8nYrCUma47Vmlg7eL1NhmyO8BKznjpqTx_T-7XQ'
    }),
    appLifecyclePlugin,
    networkPlugin,
    deeplinkPlugin,
    deeplinkManifestPlugin({
      iosTeamId: process.env.ATOLL_IOS_TEAM_ID || 'TEAMID1234',
      iosAppId: process.env.ATOLL_IOS_APP_ID || 'com.atoll.chat',
      androidPackageName: process.env.ATOLL_ANDROID_PACKAGE_NAME || 'com.atoll.chat',
      androidCertFingerprint: process.env.ATOLL_ANDROID_CERT_FINGERPRINT || 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'
    }),
    serviceWorkerPlugin({
      name: pkg.name,
      version: pkg.version
    })
  ],
  output: 'dist',
  pages: 'src/pages',
  components: 'src/components',
  styles: {
    input: ['src/scss/styles.scss'],
    processors: {
      scss: {
        silenceDeprecations: ['if-function', 'color-functions', 'global-builtin', 'import']
      }
    }
  },
  assets: [
    {
      pkg: 'libsodium-wrappers-sumo',
      path: 'dist/modules-sumo/libsodium-wrappers.js',
      dest: 'assets/libsodium-wrappers.js'
    },
    {
      src: 'src/assets/worker-bridge.js',
      dest: 'assets/worker-bridge.js'
    },
    {
      pkg: 'libsodium-sumo',
      path: 'dist/modules-sumo/libsodium-sumo.js',
      dest: 'assets/libsodium-sumo.js'
    },
    {
      pkg: 'dexie',
      path: 'dist/dexie.js',
      dest: 'assets/dexie.js'
    },
    {
      pkg: 'mediabunny',
      path: 'dist/bundles/mediabunny.min.mjs',
      dest: 'assets/mediabunny.mjs'
    },
    {
      pkg: 'altcha',
      path: 'dist/main/altcha.min.js',
      dest: 'assets/altcha.js'
    },
    {
      src: 'src/assets/register-sw.js',
      dest: 'assets/register-sw.js'
    },
    {
      pkg: '@ffmpeg/core',
      path: 'dist/esm/ffmpeg-core.js',
      dest: 'assets/ffmpeg-core.js'
    },
    {
      pkg: '@ffmpeg/core',
      path: 'dist/esm/ffmpeg-core.wasm',
      dest: 'assets/ffmpeg-core.wasm'
    },
    {
      pkg: '@ffmpeg/ffmpeg',
      path: 'dist/esm/index.js',
      dest: 'assets/ffmpeg/index.js'
    },
    {
      pkg: '@ffmpeg/ffmpeg',
      path: 'dist/esm/classes.js',
      dest: 'assets/ffmpeg/classes.js'
    },
    {
      pkg: '@ffmpeg/ffmpeg',
      path: 'dist/esm/const.js',
      dest: 'assets/ffmpeg/const.js'
    },
    {
      pkg: '@ffmpeg/ffmpeg',
      path: 'dist/esm/errors.js',
      dest: 'assets/ffmpeg/errors.js'
    },
    {
      pkg: '@ffmpeg/ffmpeg',
      path: 'dist/esm/types.js',
      dest: 'assets/ffmpeg/types.js'
    },
    {
      pkg: '@ffmpeg/ffmpeg',
      path: 'dist/esm/utils.js',
      dest: 'assets/ffmpeg/utils.js'
    },
    {
      pkg: '@ffmpeg/ffmpeg',
      path: 'dist/esm/worker.js',
      dest: 'assets/ffmpeg/worker.js'
    }
  ],
  testing: {
    mocks: {
      components: {},
      plugins: {
        config: {
          client: {
            context: (pluginContext) => {
              return () => ({
                $config: {
                  get: (key) => {
                    if (typeof window !== 'undefined' && window.sessionStorage) {
                      const stored = window.sessionStorage.getItem(`atoll_config_${key}`)
                      if (stored !== null) {
                        return !isNaN(stored) && stored.trim() !== '' ? Number(stored) : stored
                      }
                    }
                    return pluginContext.config[key]
                  }
                }
              })
            }
          }
        },
        pocketbase: {
          client: {
            context: async (pluginContext) => {
              const { default: PocketBase } = await import('pocketbase')
              const pb = new PocketBase(pluginContext.config.url)
              pb.autoCancellation(false)

              const createAuthApi = (instance) => ({
                async login (identity, password, options = {}) {
                  return await instance.collection('users').authWithPassword(identity, password, options)
                },
                async requestOTP (identity) {
                  return await instance.collection('users').requestOTP(identity)
                },
                async verifyOTP (otpId, code) {
                  return await instance.collection('users').authWithOTP(otpId, code)
                },
                async rotatePassword (newKeyBHash, newWrappedVMK, remainingWraps) {
                  return await instance.send('/api/custom/rotate_password', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      newKeyBHash,
                      newWrappedVMK,
                      remainingWraps
                    })
                  })
                },
                async recoverAccount (username) {
                  return await instance.send('/api/custom/recover_account', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      username
                    })
                  })
                },
                logout () {
                  instance.authStore.clear()
                },
                getUser () {
                  return instance.authStore.record || instance.authStore.model || null
                },
                getToken () {
                  return instance.authStore.token || ''
                },
                isAuthenticated () {
                  return Boolean(instance.authStore.isValid)
                },
                onAuthChange (callback) {
                  return instance.authStore.onChange((token, record) => {
                    callback(token, record)
                  })
                }
              })

              const createRecordApi = (instance) => ({
                async getList (collection, page = 1, perPage = 30, options = {}) {
                  return await instance.collection(collection).getList(page, perPage, options)
                },
                async getFullList (collection, options = {}) {
                  return await instance.collection(collection).getFullList(options)
                },
                async getOne (collection, id, options = {}) {
                  return await instance.collection(collection).getOne(id, options)
                },
                async getFirst (collection, filter, options = {}) {
                  return await instance.collection(collection).getFirstListItem(filter, options)
                },
                async create (collection, data, options = {}) {
                  return await instance.collection(collection).create(data, options)
                },
                async update (collection, id, data, options = {}) {
                  return await instance.collection(collection).update(id, data, options)
                },
                async delete (collection, id, options = {}) {
                  return await instance.collection(collection).delete(id, options)
                }
              })

              const createRealtimeApi = (instance) => ({
                async subscribe (collection, topic, callback, options = {}) {
                  return await instance.collection(collection).subscribe(topic, callback, options)
                },
                async unsubscribe (collection, topic) {
                  return await instance.collection(collection).unsubscribe(topic)
                }
              })

              const createFileApi = (instance) => ({
                getUrl (record, filename, options = {}) {
                  if (!record || !filename) {
                    return ''
                  }
                  return instance.files.getURL(record, filename, options)
                },
                getURL (record, filename, options = {}) {
                  if (!record || !filename) {
                    return ''
                  }
                  return instance.files.getURL(record, filename, options)
                }
              })

              return () => ({
                pb,
                auth: createAuthApi(pb),
                records: createRecordApi(pb),
                realtime: createRealtimeApi(pb),
                files: createFileApi(pb)
              })
            }
          }
        }
      }
    }
  }
})
