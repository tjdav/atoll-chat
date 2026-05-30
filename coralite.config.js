import { defineConfig } from 'coralite-scripts'
import pocketbasePlugin from './src/plugins/pocketbase.js'
import eventBus from './src/plugins/event-bus.js'
import statePlugin from './src/plugins/state-plugin.js'
import localDbPlugin from './src/plugins/localDbPlugin.js'

export default defineConfig({
  public: 'public',
  plugins: [
    pocketbasePlugin({ baseUrl: process.env.DATABASE_URL || 'http://localhost:8090' }),
    eventBus,
    statePlugin(),
    localDbPlugin()
  ],
  output: 'dist',
  pages: 'src/pages',
  components: 'src/components',
  styles: {
    input: ['src/scss/styles.scss']
  }
})
