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
  assets: [
    {
      pkg: 'altcha',
      path: 'dist/external/altcha.js',
      dest: 'assets/js/altcha.js',
      inject: {
        type: 'script',
        placement: 'body-end',
        sri: true,
        pages: ['index.html']
      }
    }
  ],
  csp: {
    enabled: true,
    hashAlgorithm: 'sha256',
    injectMeta: true,
    externalScripts: false,
    externalStyles: false
  }
})
