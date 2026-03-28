import { defineConfig } from 'coralite-scripts'
import globalStatePlugin from './src/plugins/global-state.js'
import matrixPlugin from './src/plugins/matrix.js'
import webtorrentPlugin from './src/plugins/webtorrent.js'
import mediaStorePlugin from './src/plugins/media-store.js'
import markdownPlugin from './src/plugins/markdown.js'
import ttsPlugin from './src/plugins/tts.js'
import userPreferencesPlugin from './src/plugins/user-preferences.js'
import transcriberPlugin from './src/plugins/transcriber.js'
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
      dest: 'assets/js/pkg/matrix_sdk_crypto_wasm_bg.wasm'
    },
    {
      pkg: '@transcribe/shout',
      path: 'src/shout/shout.wasm.js',
      dest: 'public/assets/transcribe/shout.wasm.js'
    }
  ],
  plugins: [
    globalStatePlugin,
    matrixPlugin({ baseUrl: process.env.HOMESERVER_URL || 'http://localhost:6167' }),
    webtorrentPlugin({ trackerUrl: process.env.TRACKER_URL || 'ws://localhost:8000' }),
    mediaStorePlugin,
    markdownPlugin,
    ttsPlugin,
    userPreferencesPlugin,
    transcriberPlugin
  ],
  output: 'dist',
  pages: 'src/pages',
  components: 'src/components',
  styles: {
    type: 'scss',
    input: 'src/scss'
  }
})
