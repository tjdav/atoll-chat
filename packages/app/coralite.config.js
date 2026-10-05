import { defineConfig } from 'coralite-scripts'
import postcssImport from 'postcss-import'
import extensionPlugin from '@atoll/extend/plugin'
import i18nPlugin from './src/plugins/i18n-plugin.js'

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
  },
  plugins: [
    extensionPlugin({ extensions: [] }),
    i18nPlugin({ defaultLocale: 'en' })
  ]
})
