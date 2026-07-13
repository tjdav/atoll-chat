import { defineConfig } from 'coralite-scripts'
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
import pkg from './package.json' with { type: 'json' }

const pocketbaseBaseUrl = process.env.DATABASE_URL || 'http://localhost:8090'

export default defineConfig({
  public: 'public',
  plugins: [
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
    bootstrapPlugin,
    webrtcPlugin(),
    notificationPlugin,
    biometricPlugin,
    pushPlugin({
      vapidKey: 'BI42LscA_XvC28RpxgGk_g0-XW5yC4S_N924_68yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2'
    }),
    appLifecyclePlugin,
    networkPlugin,
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
    }
  ]
})
