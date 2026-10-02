import { defineConfig } from 'coralite-scripts'

export default defineConfig({
  output: 'dist',
  components: 'src/components',
  pages: 'src/pages',
  public: 'public',
  mode: 'production',
  styles: {
    input: ['src/styles/main.css']
  },
  csp: {
    enabled: true,
    hashAlgorithm: 'sha256',
    injectMeta: true,
    externalScripts: false,
    externalStyles: false
  }
})
