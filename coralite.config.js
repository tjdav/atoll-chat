import { defineConfig } from 'coralite-scripts'
import eventBus from './src/plugins/event-bus.js'
import matrixPlugin from './src/plugins/matrix.js'
import webtorrentPlugin from './src/plugins/webtorrent.js'
import mediaStorePlugin from './src/plugins/media-store.js'
import markdownPlugin from './src/plugins/markdown.js'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const pkgPath = path.dirname(require.resolve('@matrix-org/matrix-sdk-crypto-wasm', { paths: [require.resolve('matrix-js-sdk')] }))
const wasmSrc = path.join(pkgPath, 'pkg/matrix_sdk_crypto_wasm_bg.wasm')

export default defineConfig({
  public: 'public',
  assets: [
    {
      src: wasmSrc,
      dest: 'pkg/matrix_sdk_crypto_wasm_bg.wasm'
    }
  ],
  plugins: [
    eventBus,
    matrixPlugin({ baseUrl: process.env.HOMESERVER_URL || 'http://localhost:6167' }),
    webtorrentPlugin,
    mediaStorePlugin,
    markdownPlugin
  ],
  output: 'dist',
  pages: 'src/pages',
  components: 'src/components',
  styles: {
    type: 'scss',
    input: 'src/scss'
  }
})
