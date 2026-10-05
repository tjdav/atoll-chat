import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TESTS_DIR = __dirname
const MANIFEST_PATH = path.join(TESTS_DIR, 'batch-manifest.toml')
const BATCH_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Minimal TOML parser for batch-manifest.toml.
 * Parses [meta] and [[batch]] tables.
 *
 * @param {string} content - TOML content string
 * @returns {{ meta: Record<string, any>, batches: Array<Record<string, any>> }} Parsed manifest
 */
export function parseManifest(content) {
  const lines = content.split(/\r?\n/)
  /** @type {string | null} */
  let currentSection = null
  /** @type {Record<string, any> | null} */
  let currentBatch = null
  /** @type {Record<string, any>} */
  const meta = {}
  /** @type {Array<Record<string, any>>} */
  const batches = []

  let inArray = false
  /** @type {any[]} */
  let arrayBuffer = []
  /** @type {string | null} */
  let arrayKey = null

  /**
   * Strips comments outside quoted strings.
   *
   * @param {string} lineStr - Line string
   * @returns {string} Line with comments stripped
   */
  function stripComment(lineStr) {
    let inString = false
    for (let i = 0; i < lineStr.length; i++) {
      const ch = lineStr[i]
      if (ch === '"') inString = !inString
      if (ch === '#' && !inString) {
        return lineStr.slice(0, i)
      }
    }
    return lineStr
  }

  /**
   * Parses a primitive TOML value (integer or string).
   *
   * @param {string} valStr - Raw value string
   * @returns {string | number} Parsed scalar value
   */
  function parseValue(valStr) {
    const trimmed = valStr.trim()
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10)
    }
    if (/^"[^"]*"$/.test(trimmed)) {
      return trimmed.slice(1, -1)
    }
    throw new Error(`Invalid TOML value: ${valStr}`)
  }

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo] ?? ''
    const line = stripComment(rawLine).trim()
    if (!line && !inArray) continue

    if (inArray) {
      let chunk = line
      const closingIdx = chunk.indexOf(']')
      if (closingIdx !== -1) {
        chunk = chunk.slice(0, closingIdx)
        inArray = false
      }
      const items = chunk
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const item of items) {
        arrayBuffer.push(parseValue(item))
      }

      if (!inArray && arrayKey) {
        if (currentSection === 'batch' && currentBatch) {
          currentBatch[arrayKey] = arrayBuffer
        } else if (currentSection === 'meta') {
          meta[arrayKey] = arrayBuffer
        }
        arrayBuffer = []
        arrayKey = null
      }
      continue
    }

    if (line === '[meta]') {
      currentSection = 'meta'
      continue
    }

    if (line === '[[batch]]') {
      currentSection = 'batch'
      currentBatch = {}
      batches.push(currentBatch)
      continue
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      throw new Error(`Unknown section header at line ${lineNo + 1}: ${line}`)
    }

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) {
      throw new Error(`Invalid syntax at line ${lineNo + 1}: ${line}`)
    }

    const key = line.slice(0, eqIdx).trim()
    const val = line.slice(eqIdx + 1).trim()

    if (val.startsWith('[')) {
      const closingIdx = val.indexOf(']')
      if (closingIdx !== -1) {
        const inner = val.slice(1, closingIdx).trim()
        const items = inner
          ? inner
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => parseValue(s))
          : []
        if (currentSection === 'meta') meta[key] = items
        else if (currentSection === 'batch' && currentBatch) currentBatch[key] = items
        else throw new Error(`Key "${key}" outside section at line ${lineNo + 1}`)
      } else {
        inArray = true
        arrayKey = key
        arrayBuffer = []
        const inner = val.slice(1).trim()
        if (inner) {
          const items = inner
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          for (const item of items) {
            arrayBuffer.push(parseValue(item))
          }
        }
      }
      continue
    }

    const parsedVal = parseValue(val)
    if (currentSection === 'meta') {
      meta[key] = parsedVal
    } else if (currentSection === 'batch' && currentBatch) {
      currentBatch[key] = parsedVal
    } else {
      throw new Error(`Key "${key}" outside section at line ${lineNo + 1}`)
    }
  }

  if (inArray) {
    throw new Error('Unterminated array in TOML manifest')
  }

  return { meta, batches }
}

/**
 * Recursively walks a directory and collects test files (*.test.js).
 *
 * @param {string} dir - Directory path to walk
 * @returns {string[]} Array of file paths relative to TESTS_DIR using forward slashes
 */
function findTestFiles(dir) {
  if (!fs.existsSync(dir)) return []
  /** @type {string[]} */
  const results = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      const relPath = path.relative(TESTS_DIR, fullPath).split(path.sep).join('/')
      results.push(relPath)
    }
  }
  return results
}

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

function runCheck() {
  /** @type {string[]} */
  const errors = []

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

  // Validate [meta]
  if (typeof meta['max_batch_seconds'] !== 'number' || meta['max_batch_seconds'] <= 0) {
    errors.push('Manifest [meta] must define max_batch_seconds as a positive integer.')
  }

  // Validate [batch] entries
  const seenBatchNames = new Set()
  /** @type {Map<string, string[]>} */
  const manifestFileMap = new Map() // normalizedPath -> array of batchNames

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    if (!batch) continue

    const batchName = batch['name']
    const batchFiles = batch['files']

    if (typeof batchName !== 'string' || !BATCH_NAME_PATTERN.test(batchName)) {
      errors.push(`Batch index ${i} has invalid or missing name: "${batchName}". Name must match ^[a-z][a-z0-9-]*$.`)
    } else if (seenBatchNames.has(batchName)) {
      errors.push(`Duplicate batch name: "${batchName}".`)
    } else {
      seenBatchNames.add(batchName)
    }

    if (!Array.isArray(batchFiles)) {
      errors.push(`Batch "${batchName || i}" files property must be an array.`)
    } else {
      for (const rawFile of batchFiles) {
        if (typeof rawFile !== 'string') {
          errors.push(`Batch "${batchName || i}" contains non-string file path.`)
          continue
        }
        const norm = normalizePath(rawFile)

        // Check if file exists on disk
        const absolutePath = path.join(TESTS_DIR, norm)
        if (!fs.existsSync(absolutePath)) {
          errors.push(`Batch "${batchName}" lists file "${norm}" which does not exist on disk.`)
        }

        let list = manifestFileMap.get(norm)
        if (!list) {
          list = []
          manifestFileMap.set(norm, list)
        }
        list.push(String(batchName))
      }
    }
  }

  // Check duplicate files in manifest
  for (const [normPath, batchList] of manifestFileMap.entries()) {
    if (batchList.length > 1) {
      errors.push(`Duplicate file across batches: "${normPath}" (found in batches: ${batchList.join(', ')}).`)
    }
  }

  // Collect disk test files under tests/unit/ and tests/integration/
  const unitFiles = findTestFiles(path.join(TESTS_DIR, 'unit'))
  const integrationFiles = findTestFiles(path.join(TESTS_DIR, 'integration'))
  const diskTestFiles = [...unitFiles, ...integrationFiles]

  // Check unbatched files on disk
  for (const diskFile of diskTestFiles) {
    if (!manifestFileMap.has(diskFile)) {
      errors.push(`Unbatched test file found on disk: "${diskFile}".`)
    }
  }

  if (errors.length > 0) {
    console.error('Batch manifest check failed with the following errors:')
    for (const err of errors) {
      console.error(` - ${err}`)
    }
    process.exit(1)
  }

  console.log('Batch manifest check passed cleanly.')
}

/**
 * Runs a single batch by name.
 *
 * @param {string} batchName - Batch name to execute
 */
function runSingleBatch(batchName) {
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

  const batch = manifest.batches.find((b) => b['name'] === batchName)
  if (!batch) {
    console.error(`Error: Batch "${batchName}" not found in manifest.`)
    process.exit(1)
  }

  const batchFiles = batch['files']
  if (!Array.isArray(batchFiles) || batchFiles.length === 0) {
    console.log(`Batch "${batchName}" is empty.`)
    process.exit(0)
  }

  const absoluteFilePaths = batchFiles.map((f) => path.join(TESTS_DIR, normalizePath(String(f))))
  const result = spawnSync('node', ['--test', ...absoluteFilePaths], {
    stdio: 'inherit',
    cwd: TESTS_DIR
  })

  process.exit(result.status ?? 1)
}

function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--batch') {
    const batchName = args[1]
    if (!batchName) {
      console.error('Error: --batch requires a batch name argument.')
      process.exit(1)
    }
    runSingleBatch(batchName)
  } else {
    runCheck()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
