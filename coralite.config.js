import { defineConfig } from 'coralite-scripts'
import pocketbasePlugin from './src/plugins/pockbase.js'
import eventBus from './src/plugins/event-bus.js'
import cryptoPlugin from './src/plugins/crypto.js'
import storagePlugin from './src/plugins/storage.js'

export default defineConfig({
  public: 'public',
  plugins: [
    pocketbasePlugin,
    eventBus,
    cryptoPlugin,
    storagePlugin
  ],
  output: 'dist',
  pages: 'src/pages',
  templates: 'src/templates',
  styles: {
    type: 'scss',
    input: 'src/scss'
  }
})
