#!/usr/bin/env node
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import batches from '../test-batches.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const testsDir = join(packageRoot, 'tests')

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(full))
    } else if (entry.name.endsWith('.test.js')) {
      files.push(relative(packageRoot, full).split(sep).join('/'))
    }
  }
  return files
}

const discovered = await walk(testsDir).catch(() => [])

const seen = new Map()
const duplicates = []
for (const batch of batches) {
  for (const file of batch.files) {
    if (seen.has(file)) {
      duplicates.push({ file, batches: [seen.get(file), batch.name] })
    } else {
      seen.set(file, batch.name)
    }
  }
}

const declared = new Set(seen.keys())
const orphans = discovered.filter((f) => !declared.has(f))
const phantoms = [...declared].filter((f) => !discovered.includes(f))

let failed = false

if (orphans.length > 0) {
  console.error('Orphan test files (present on disk, absent from every batch):')
  for (const f of orphans) console.error(`  - ${f}`)
  failed = true
}

if (phantoms.length > 0) {
  console.error('Phantom entries (listed in a batch, missing from disk):')
  for (const f of phantoms) console.error(`  - ${f}`)
  failed = true
}

if (duplicates.length > 0) {
  console.error('Duplicate assignments (file listed in more than one batch):')
  for (const { file, batches: bs } of duplicates) {
    console.error(`  - ${file}: ${bs.join(', ')}`)
  }
  failed = true
}

if (failed) {
  process.exit(1)
}

console.log(`OK — ${discovered.length} test file(s) across ${batches.length} batch(es).`)
