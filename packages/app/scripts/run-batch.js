#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import batches from '../test-batches.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = dirname(here)

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

const runnerType = batch.runner

const runners = {
  node: (files) => ({ cmd: 'node', args: ['--test', ...files] }),
  playwright: (files) => ({ cmd: 'pnpm', args: ['exec', 'playwright', 'test', ...files] }),
}

const runner = runners[runnerType]
if (!runner) {
  console.error(`Batch runner "${runnerType}" is not registered.`)
  process.exit(1)
}

const { cmd, args } = runner(batch.files)
const child = spawn(cmd, args, { stdio: 'inherit', cwd: packageRoot })

let timedOut = false
const timeoutMs = 60_000
const timer = setTimeout(() => {
  timedOut = true
  console.error(`\nBatch "${name}" timed out after 60 seconds. Exiting...`)
  child.kill('SIGTERM')
  setTimeout(() => child.kill('SIGKILL'), 5000).unref()
}, timeoutMs)

child.on('exit', (code) => {
  clearTimeout(timer)
  if (timedOut) {
    process.exit(1)
  }
  process.exit(code ?? 0)
})

child.on('error', (err) => {
  clearTimeout(timer)
  console.error(`Failed to spawn runner: ${err.message}`)
  process.exit(1)
})
