import { defineConfig } from 'coralite-scripts'
import eventBus from './src/plugins/event-bus.js'
import matrixPlugin from './src/plugins/matrix.js'
import webtorrentPlugin from './src/plugins/webtorrent.js'
import mediaStorePlugin from './src/plugins/media-store.js'

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const wasmAssetsPlugin = {
  name: 'wasm-assets',
  hooks: {
    async 'build:end' () {
      const src = path.resolve(__dirname, 'node_modules/@matrix-org/matrix-sdk-crypto-wasm/matrix_sdk_crypto_wasm_bg.wasm')
      const dest = path.resolve(__dirname, 'dist/matrix_sdk_crypto_wasm_bg.wasm')
      fs.copyFileSync(src, dest)

      const publicDest = path.resolve(__dirname, 'public/matrix_sdk_crypto_wasm_bg.wasm')
      if (fs.existsSync(path.resolve(__dirname, 'public'))) {
        fs.copyFileSync(src, publicDest)
      }
    }
  }
}

export default defineConfig({
  public: 'public',
  plugins: [
    eventBus,
    matrixPlugin({ baseUrl: process.env.HOMESERVER_URL || 'http://localhost:6167' }),
    webtorrentPlugin,
    mediaStorePlugin,
    wasmAssetsPlugin
  ],
  output: 'dist',
  pages: 'src/pages',
  components: 'src/components',
  styles: {
    type: 'scss',
    input: 'src/scss'
  }
})
