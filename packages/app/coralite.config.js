import { defineConfig } from 'coralite-scripts'
import postcssImport from 'postcss-import'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import extensionPlugin from '@atoll/extend/plugin'
import statePlugin from './src/plugins/state-plugin.js'
import iconPlugin from './src/plugins/icon-plugin.js'
import storagePlugin from './src/plugins/storage-plugin.js'
import syncPlugin from './src/plugins/sync-plugin.js'
import routerPlugin from './src/plugins/router-plugin.js'
import floatingPlugin from './src/plugins/floating-plugin.js'
import i18nPlugin from './src/plugins/i18n-plugin.js'
import { extensions } from './src/extensions/index.js'

function loadMigrations() {
  const dir = new URL('./src/db/migrations/', import.meta.url).pathname
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  return files.map((name) => ({
    name,
    sql: readFileSync(join(dir, name), 'utf8')
  }))
}

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
      pkg: '@sqlite.org/sqlite-wasm',
      path: 'dist/sqlite3.wasm',
      dest: 'assets/sqlite/sqlite3.wasm'
    },
    {
      pkg: '@sqlite.org/sqlite-wasm',
      path: 'dist/sqlite3-opfs-async-proxy.js',
      dest: 'assets/sqlite/sqlite3-opfs-async-proxy.js'
    }
  ],
  csp: {
    enabled: true,
    hashAlgorithm: 'sha256',
    injectMeta: true,
    externalScripts: false,
    externalStyles: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'wasm-unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'worker-src': ["'self'", 'blob:'],
      'connect-src': ["'self'"]
    }
  },
  plugins: [
    extensionPlugin({ extensions }),
    statePlugin({ initialState: {} }),
    iconPlugin(),
    storagePlugin({ dbName: 'messenger', migrations: loadMigrations() }),
    syncPlugin(),
    routerPlugin(),
    floatingPlugin(),
    i18nPlugin({ defaultLocale: 'en' })
  ]
})
