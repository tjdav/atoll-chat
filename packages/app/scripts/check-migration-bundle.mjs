#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, '..')
const migrationsDir = join(appRoot, 'src/db/migrations')
const bundleDir = join(appRoot, 'dist/assets/js')

async function main() {
  let files
  try {
    files = await readdir(bundleDir)
  } catch {
    console.error(`Bundle directory not found: ${bundleDir}. Run the build first.`)
    process.exit(1)
  }
  const jsFiles = files.filter((f) => f.endsWith('.js'))
  const contents = await Promise.all(
    jsFiles.map(async (f) => ({ name: f, content: await readFile(join(bundleDir, f), 'utf8') }))
  )

  const migrationNames = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  const missing = []
  for (const name of migrationNames) {
    const found = contents.some((c) => c.content.includes(name))
    if (!found) missing.push(name)
  }

  if (missing.length > 0) {
    console.error(`Missing migrations in bundle: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`All ${migrationNames.length} migrations present in the bundle.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
