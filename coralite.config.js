import { defineConfig } from 'coralite-scripts'
import eventBus from './src/plugins/event-bus.js'
import matrixPlugin from './src/plugins/matrix.js'
import webtorrentPlugin from './src/plugins/webtorrent.js'
import mediaStorePlugin from './src/plugins/media-store.js'

export default defineConfig({
  public: 'public',
  plugins: [
    eventBus,
    matrixPlugin,
    webtorrentPlugin,
    mediaStorePlugin
  ],
  output: 'dist',
  pages: 'src/pages',
  components: 'src/components',
  styles: {
    type: 'scss',
    input: 'src/scss'
  }
})
