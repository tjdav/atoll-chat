import { defineConfig } from 'coralite-scripts'
import globalStatePlugin from './src/plugins/global-state.js'
import localDbPlugin from './src/plugins/local-db.js'
import cryptoPlugin from './src/plugins/crypto.js'
import webtorrentPlugin from './src/plugins/webtorrent.js'
import mediaStorePlugin from './src/plugins/media-store.js'
import markdownPlugin from './src/plugins/markdown.js'
import ttsPlugin from './src/plugins/tts.js'
import userPreferencesPlugin from './src/plugins/user-preferences.js'
import transcriberPlugin from './src/plugins/transcriber.js'
export default defineConfig({
  public: 'public',
  assets: [
    {
      pkg: '@transcribe/shout', // eslint-disable-line id-denylist
      path: 'src/shout/shout.wasm.js',
      dest: 'public/assets/transcribe/shout.wasm.js'
    }
  ],
  plugins: [
    localDbPlugin,
    cryptoPlugin,
    globalStatePlugin,
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
