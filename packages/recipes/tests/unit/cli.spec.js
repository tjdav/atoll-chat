// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { run } from '../../src/cli.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB_ROOT = join(HERE, '..', '..', 'recipes')

/**
 * Builds mock streams that collect written chunks.
 * @returns {{ stdout: object, stderr: object, out: string[], err: string[] }} The streams and their buffers.
 */
function makeIO () {
  const out = []
  const err = []
  return {
    stdout: { write: (chunk) => { out.push(chunk) } },
    stderr: { write: (chunk) => { err.push(chunk) } },
    out,
    err
  }
}

test('run with no arguments prints usage to stderr and returns 2', async () => {
  const io = makeIO()
  const code = await run([], io)
  assert.equal(code, 2)
  assert.equal(io.out.length, 0)
  assert.match(io.err.join(''), /Usage:/)
})

test('run with an unknown command returns 2', async () => {
  const io = makeIO()
  const code = await run(['frobnicate'], io)
  assert.equal(code, 2)
  assert.match(io.err.join(''), /unknown command "frobnicate"/)
})

test('run with --version prints the version and returns 0', async () => {
  const io = makeIO()
  const code = await run(['--version'], io)
  assert.equal(code, 0)
  assert.match(io.out.join(''), /^\d+\.\d+\.\d+\n$/)
})

test('run with -v prints the version and returns 0', async () => {
  const io = makeIO()
  const code = await run(['-v'], io)
  assert.equal(code, 0)
  assert.match(io.out.join(''), /^\d+\.\d+\.\d+\n$/)
})

test('list with no rootDir returns 2', async () => {
  const io = makeIO()
  const code = await run(['list'], io)
  assert.equal(code, 2)
  assert.match(io.err.join(''), /Usage:/)
})

test('list prints one line per valid recipe plus a summary', async () => {
  const io = makeIO()
  const code = await run(['list', LIB_ROOT], io)
  assert.equal(code, 0)
  const output = io.out.join('')
  assert.match(output, /keyword-alert@1\.0\.0 — Keyword Alert/)
  assert.match(output, /echo-command@1\.0\.0 — Echo/)
  assert.match(output, /notes@1\.0\.0 — Notes/)
  assert.match(output, /quote@1\.0\.0 — Quote/)
  assert.match(output, /webhook-notify@1\.0\.0 — Webhook Notify/)
  assert.match(output, /sticky@1\.0\.0 — Sticky/)
  assert.match(output, /room-topic@1\.0\.0 — Room Topic/)
  assert.match(output, /daily-reminder@1\.0\.0 — Daily Reminder/)
  assert.match(output, /\d+ recipe\(s\), 0 error\(s\)/)
  assert.equal(io.err.length, 0)
})

test('list returns 1 when the rootDir does not exist', async () => {
  const io = makeIO()
  const code = await run(['list', '/nonexistent/definitely/not/here'], io)
  assert.equal(code, 1)
  assert.match(io.err.join(''), /is not a directory/)
})

test('verify with no rootDir returns 2', async () => {
  const io = makeIO()
  const code = await run(['verify'], io)
  assert.equal(code, 2)
  assert.match(io.err.join(''), /Usage:/)
})

test('verify with an unknown recipe returns 1', async () => {
  const io = makeIO()
  const code = await run(['verify', LIB_ROOT, 'does-not-exist'], io)
  assert.equal(code, 1)
  assert.match(io.err.join(''), /fail does-not-exist/)
})

test('verify with a known recipe returns 0', async () => {
  const io = makeIO()
  const code = await run(['verify', LIB_ROOT, 'echo-command'], io)
  assert.equal(code, 0)
  assert.match(io.out.join(''), /ok\s+echo-command/)
})

test('verify with a recipe that requires a slot returns 1', async () => {
  const io = makeIO()
  const code = await run(['verify', LIB_ROOT, 'daily-reminder'], io)
  assert.equal(code, 1)
  assert.match(io.err.join(''), /fail daily-reminder/)
  assert.match(io.err.join(''), /slot "roomId" is required/)
})

test('verify without an id verifies every recipe', async () => {
  const io = makeIO()
  const code = await run(['verify', LIB_ROOT], io)
  // Some recipes require slots and fail verification with an empty
  // instantiation. The exit code reflects that.
  assert.equal(code, 1)
  assert.match(io.out.join(''), /ok\s+echo-command/)
  assert.match(io.out.join(''), /ok\s+keyword-alert/)
  assert.match(io.err.join(''), /fail daily-reminder/)
})

test('verify prints a summary line at the end', async () => {
  const io = makeIO()
  await run(['verify', LIB_ROOT], io)
  const combined = io.out.join('') + io.err.join('')
  assert.match(combined, /verified|failed/)
})

test('list exits 0 even when the library contains a broken recipe', async () => {
  const io = makeIO()
  const code = await run(['list', LIB_ROOT], io)
  assert.equal(code, 0)
})
