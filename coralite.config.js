import { defineConfig } from 'coralite-scripts'
import pocketbasePlugin from './src/plugins/pocketbase.js'
import eventBus from './src/plugins/event-bus.js'
import statePlugin from './src/plugins/state-plugin.js'
import localDbPlugin from './src/plugins/localDbPlugin.js'
import workerPlugin from './src/plugins/workerPlugin.js'
import syncPlugin from './src/plugins/syncPlugin.js'
import webrtcPlugin from './src/plugins/webrtcPlugin.js'

export default defineConfig({
  public: 'public',
  plugins: [
    pocketbasePlugin({ baseUrl: process.env.DATABASE_URL || 'http://localhost:8090' }),
    eventBus,
    statePlugin({ initialState: { currentAppView: 'chats' } }),
    localDbPlugin(),
    workerPlugin(),
    syncPlugin(),
    webrtcPlugin()
  ],
  output: 'dist',
  pages: 'src/pages',
  components: 'src/components',
  styles: {
    input: ['src/scss/styles.scss']
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
    }
  ]
})
