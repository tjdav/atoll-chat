import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { definePlugin } from 'coralite'

/**
 * Metadata Plugin for Atoll Chat server worker
 * Extracts version from package.json and implements byte-level cache busting
 * for the service worker and background worker by injecting versions.
 */
export default function (config) {
  return definePlugin({
    name: 'serviceWorker',
    server: {
      onAfterBuild: async ({ app }) => {
        const version = config.version || '0.0.0'
        const projectRoot = process.cwd()
        const outputDir = app.options.output

        if (!outputDir) {
          return
        }

        // Generate metadata.js
        await app.writeFile('assets/metadata.js', `self.metadata = {
          name: '${config.name}',
          version: '${version}'
        }`)

        // Generate worker-bridge.js
        try {
          const bridgeSrcPath = join(projectRoot, 'src', 'assets', 'worker-bridge.js')
          const bridgeContent = await readFile(bridgeSrcPath, 'utf-8')
          await app.writeFile('assets/worker-bridge.js', bridgeContent)
        } catch (err) {
          console.error('[serviceWorker plugin] Failed to copy worker-bridge.js to output:', err)
        }

        // Generate url.js (stripping exports so it's compatible with importScripts)
        try {
          const urlSrcPath = join(projectRoot, 'src', 'utils', 'url.js')
          const urlContent = await readFile(urlSrcPath, 'utf-8')
          const workerUrlContent = urlContent.replace(/^export\s+/gm, '')
          await app.writeFile('assets/url.js', workerUrlContent)
        } catch (err) {
          console.error('[serviceWorker plugin] Failed to generate assets/url.js:', err)
        }

        // Cache-bust sw.js
        try {
          const swPath = join(projectRoot, 'src', 'workers', 'sw.js')
          let swContent = await readFile(swPath, 'utf-8')

          // Inject version comment
          swContent = `// version: ${version}\n${swContent}`

          // Add versioned query parameter to all asset importScripts
          swContent = swContent.replace(
            /importScripts\(['"](\/assets\/[^'"]+\.js)['"]\)/g,
            `importScripts('$1?v=${version}')`
          )

          await app.writeFile('sw.js', swContent)
        } catch (err) {
          console.error('[serviceWorker plugin] Failed to process sw.js:', err)
        }

        // cache-bust worker.js
        try {
          const workerPath = join(projectRoot, 'src', 'workers', 'worker.js')
          let workerContent = await readFile(workerPath, 'utf-8')

          // Inject version comment
          workerContent = `// version: ${version}\n${workerContent}`

          // Add versioned query parameter to all asset importScripts
          workerContent = workerContent.replace(
            /importScripts\(['"](\/assets\/[^'"]+\.js)['"]\)/g,
            `importScripts('$1?v=${version}')`
          )

          await app.writeFile('worker.js', workerContent)
        } catch (err) {
          console.error('[serviceWorker plugin] Failed to process worker.js:', err)
        }
      }
    }
  })
}
