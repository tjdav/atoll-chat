import { defineConfig } from 'coralite-scripts'
import pocketbasePlugin from './src/plugins/pockbase.js'

export default defineConfig({
  public: 'public',
  plugins: [
    pocketbasePlugin
  ],
  output: 'dist',
  pages: 'src/pages',
  templates: 'src/templates',
  styles: {
    type: 'scss',
    input: 'src/scss'
  }
})
