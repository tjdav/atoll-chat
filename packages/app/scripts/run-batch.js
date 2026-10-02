#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import batches from '../test-batches.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

const name = process.argv[2]
if (!name) {
  console.error('Usage: pnpm test:batch <batch-name>')
  console.error(`Available: ${batches.map((b) => b.name).join(', ')}`)
  process.exit(1)
}

const batch = batches.find((b) => b.name === name)
if (!batch) {
  console.error(`Unknown batch: ${name}`)
  console.error(`Available: ${batches.map((b) => b.name).join(', ')}`)
  process.exit(1)
}

// Runner registry. e2e and component runners are added by C-INFRA-4
// when Playwright is installed.
const runners = {
  unit: (files) => ({ cmd: 'node', args: ['--test', ...files] }),
}

const runner = runners[batch.type]
if (!runner) {
  console.error(`Batch type "${batch.type}" has no registered runner.`)
  console.error(`Add one in scripts/run-batch.js when the tooling lands.`)
  process.exit(1)
}

const { cmd, args } = runner(batch.files)
const child = spawn(cmd, args, { stdio: 'inherit', cwd: packageRoot })
child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error(`Failed to spawn runner: ${err.message}`)
  process.exit(1)
})
