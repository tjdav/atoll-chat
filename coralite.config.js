import { defineConfig } from 'coralite-scripts'
import pocketbasePlugin from './src/plugins/pocketbase.js'
import eventBus from './src/plugins/event-bus.js'
import statePlugin from './src/plugins/state-plugin.js'
import localDbPlugin from './src/plugins/local-db-plugin.js'
import utilsPlugin from './src/plugins/utils-plugin.js'
import cryptoPlugin from './src/plugins/crypto-worker.js'
import syncPlugin from './src/plugins/sync-plugin.js'
import webrtcPlugin from './src/plugins/web-rtc-plugin.js'
import bootstrapPlugin from './src/plugins/bootstrap.js'

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
        currentUser: null,
        authView: 'login',
        currentAppView: 'chats',
        activeSelectionId: null,
        activeSelectionType: null,
        playbackStatus: 'idle',
        currentMedia: null,
        mediaQueue: [],
        mediaVolume: 1.0,
        mediaProgress: 0,
        mediaDuration: 0,
        mediaCurrentTime: 0,
        mediaMetadata: {
          title: 'Not Playing',
          subtext: '',
          thumbnail: null,
          placeholderIcon: 'bi-music-note'
        },
        currentMessageText: '',
        callStatus: 'idle',
        activeCallRoomId: null
      }
    }),
    localDbPlugin(),
    utilsPlugin,
    cryptoPlugin({ url: pocketbaseBaseUrl }),
    syncPlugin(),
    bootstrapPlugin,
    webrtcPlugin()
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
      pkg: 'libsodium-sumo',
      path: 'dist/modules-sumo/libsodium-sumo.js',
      dest: 'assets/libsodium-sumo.js'
    },
    {
      pkg: 'dexie',
      path: 'dist/dexie.js',
      dest: 'assets/dexie.js'
    }
  ]
})
