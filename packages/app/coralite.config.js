import { defineConfig } from 'coralite-scripts'
import postcssImport from 'postcss-import'

export default defineConfig({
  output: 'dist',
  components: 'src/components',
  pages: 'src/pages',
  public: 'public',
  mode: 'production',
  styles: {
    input: ['src/styles/main.css'],
    processors: {
      postcss: {
        plugins: [
          postcssImport()
        ]
      }
    }
  },
  csp: {
    enabled: true,
    hashAlgorithm: 'sha256',
    injectMeta: true,
    externalScripts: false,
    externalStyles: false
  }
})
