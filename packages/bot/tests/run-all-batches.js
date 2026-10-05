import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseManifest } from './manifest-check.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TESTS_DIR = __dirname
const MANIFEST_PATH = path.join(TESTS_DIR, 'batch-manifest.toml')

/**
 * Normalizes a manifest file path string to forward slashes without leading ./
 *
 * @param {string} filePath - File path string
 * @returns {string} Normalized path
 */
function normalizePath(filePath) {
  let normalized = filePath.replaceAll('\\', '/').trim()
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2)
  }
  return normalized
}

function runAllBatches() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Error: Manifest file not found at ${MANIFEST_PATH}`)
    process.exit(1)
  }

  /** @type {{ meta: Record<string, any>, batches: Array<Record<string, any>> }} */
  let manifest
  try {
    const rawContent = fs.readFileSync(MANIFEST_PATH, 'utf8')
    manifest = parseManifest(rawContent)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Manifest parse error: ${msg}`)
    process.exit(1)
  }

  const { meta, batches } = manifest
  const maxBatchSeconds = typeof meta['max_batch_seconds'] === 'number' ? meta['max_batch_seconds'] : 60

  if (!batches || batches.length === 0) {
    console.log('no batches declared')
    process.exit(0)
  }

  console.log(`Executing ${batches.length} test batch(es)...`)

  for (const batch of batches) {
    const batchName = typeof batch['name'] === 'string' ? batch['name'] : 'unnamed'
    const batchFiles = Array.isArray(batch['files']) ? batch['files'] : []

    if (batchFiles.length === 0) {
      console.log(`Batch "${batchName}": (empty) - skipped`)
      continue
    }

    console.log(`\n--- Running batch: "${batchName}" (${batchFiles.length} file(s)) ---`)
    const absoluteFilePaths = batchFiles.map((f) => path.join(TESTS_DIR, normalizePath(String(f))))

    const startTime = Date.now()
    const result = spawnSync('node', ['--test', ...absoluteFilePaths], {
      stdio: 'inherit',
      cwd: TESTS_DIR
    })
    const durationMs = Date.now() - startTime
    const durationSec = durationMs / 1000

    if (result.status !== 0) {
      console.error(`\nBatch "${batchName}" FAILED with exit code ${result.status ?? 1} after ${durationSec.toFixed(2)}s`)
      process.exit(result.status ?? 1)
    }

    console.log(`Batch "${batchName}" PASSED in ${durationSec.toFixed(2)}s`)

    if (durationSec > maxBatchSeconds) {
      console.warn(`\nWARNING: Batch "${batchName}" took ${durationSec.toFixed(2)}s, exceeding max_batch_seconds budget of ${maxBatchSeconds}s!`)
    }
  }

  console.log('\nAll test batches passed cleanly.')
}

runAllBatches()
