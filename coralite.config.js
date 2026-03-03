import { defineConfig } from 'coralite-scripts'
import pocketbasePlugin from './src/plugins/pockbase.js'
import eventBus from './src/plugins/event-bus.js'

export default defineConfig({
  public: 'public',
  plugins: [
    pocketbasePlugin,
    eventBus
  ],
  output: 'dist',
  pages: 'src/pages',
  templates: 'src/templates',
  styles: {
    type: 'scss',
    input: 'src/scss'
  }
})
