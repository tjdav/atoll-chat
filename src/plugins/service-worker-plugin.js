import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { definePlugin } from 'coralite'

/**
 * Helper to recursively list files in a directory
 */
async function getFilesRecursively (dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const res = join(dir, entry.name)
      if (entry.isDirectory()) {
        return getFilesRecursively(res)
      } else {
        return res
      }
    })
  )
  return files.flat()
}

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

        // 1. Scan output directory for files to cache (excluding sw.js and .map files)
        let assetsToCache = []
        try {
          const allFiles = await getFilesRecursively(outputDir)
          const filteredFiles = allFiles.filter((filePath) => {
            const fileName = filePath.split(/[/\\]/).pop()
            // Exclude sw.js itself, any .map file, and any metadata/tmp files if needed
            return fileName !== 'sw.js' && !fileName.endsWith('.map')
          })

          // Map files to web-relative paths starting with '/'
          const mappedAssets = filteredFiles.map((filePath) => {
            const relPath = relative(outputDir, filePath).replace(/\\/g, '/')
            return '/' + relPath
          })

          // Ensure '/' and '/index.html' are always included and sorted nicely
          const baseAssets = ['/', '/index.html']
          const uniqueAssets = new Set(baseAssets)

          // Sort mapped assets to keep output clean and deterministic
          mappedAssets.sort().forEach((asset) => {
            if (asset !== '/index.html') {
              uniqueAssets.add(asset)
            }
          })

          assetsToCache = Array.from(uniqueAssets)
        } catch (err) {
          console.error('[serviceWorker plugin] Failed to scan output directory assets:', err)
          // Fallback assets
          assetsToCache = [
            '/',
            '/index.html',
            '/worker.js',
            '/favicon.ico',
            '/assets/css/styles.css',
            '/assets/libsodium-wrappers.js',
            '/assets/libsodium-sumo.js',
            '/assets/dexie.js'
          ]
        }

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

          // Replace ASSETS_TO_CACHE list with our dynamically generated assetsToCache list
          const assetsJson = JSON.stringify(assetsToCache, null, 2)
          swContent = swContent.replace(
            /const\s+ASSETS_TO_CACHE\s*=\s*\[[^\]]*\]/m,
            `const ASSETS_TO_CACHE = ${assetsJson}`
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
