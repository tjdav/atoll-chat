import { definePlugin } from 'coralite'

/**
 * Metadata Plugin for Atoll Chat server worker
 * Extracts version from package.json and writes it to metadata.json in the output directory.
 */
export default function (config) {
  return definePlugin({
    name: 'serviceWorker',
    server: {
      onAfterBuild: async ({ app }) => {
        const version = config.version || '0.0.0'

        await app.writeFile('assets/metadata.js', `self.metadata = {
          name: '${config.name}',
          version: '${version}'
        }`)
      }
    }
  })
}
