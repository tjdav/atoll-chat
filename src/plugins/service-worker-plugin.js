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

        // Cache-bust sw.js
        try {
          const swPath = join(projectRoot, 'src', 'workers', 'sw.js')
          let swContent = await readFile(swPath, 'utf-8')

          // Inject version comment
          swContent = `// version: ${version}\n${swContent}`

          // Add versioned query parameter to metadata import
          swContent = swContent.replace(
            "importScripts('/assets/metadata.js')",
            `importScripts('/assets/metadata.js?v=${version}')`
          )

          const destSwPath = join(outputDir, 'sw.js')
          await mkdir(dirname(destSwPath), { recursive: true })
          await writeFile(destSwPath, swContent)
          app.trackOutputFile(destSwPath)
        } catch (err) {
          console.error('[serviceWorker plugin] Failed to process sw.js:', err)
        }

        // 3. Cache-bust worker.js
        try {
          const workerPath = join(projectRoot, 'src', 'workers', 'worker.js')
          let workerContent = await readFile(workerPath, 'utf-8')

          // Inject version comment
          workerContent = `// version: ${version}\n${workerContent}`

          const destWorkerPath = join(outputDir, 'worker.js')
          await mkdir(dirname(destWorkerPath), { recursive: true })
          await writeFile(destWorkerPath, workerContent)
          app.trackOutputFile(destWorkerPath)
        } catch (err) {
          console.error('[serviceWorker plugin] Failed to process worker.js:', err)
        }
      }
    }
  })
}
