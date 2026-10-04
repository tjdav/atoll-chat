import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const shellDir = resolve(import.meta.dirname, '../../src/components/shell')

test('messenger-shell uses defineComponent', async () => {
  const src = await readFile(resolve(shellDir, 'messenger-shell.html'), 'utf8')
  assert.match(src, /import\s*\{[^}]*\bdefineComponent\b[^}]*\}\s*from\s*['"]coralite['"]/)
  assert.match(src, /export\s+default\s+defineComponent\s*\(/)
})

test('messenger-shell template contains rail-host, surface-host, and nav', async () => {
  const src = await readFile(resolve(shellDir, 'messenger-shell.html'), 'utf8')
  assert.match(src, /<rail-host/)
  assert.match(src, /<surface-host/)
  assert.match(src, /<nav[^>]*class="shell__bottom-nav"/)
})

test('messenger-shell subscribes to app:ready', async () => {
  const src = await readFile(resolve(shellDir, 'messenger-shell.html'), 'utf8')
  assert.match(src, /app:ready/)
})

test('messenger-shell style getter gates on state.ready', async () => {
  const src = await readFile(resolve(shellDir, 'messenger-shell.html'), 'utf8')
  assert.match(src, /state\.ready\s*\?\s*['"]block['"]\s*:\s*['"]none['"]/)
})

test('rail-host uses defineComponent', async () => {
  const src = await readFile(resolve(shellDir, 'rail-host.html'), 'utf8')
  assert.match(src, /export\s+default\s+defineComponent\s*\(/)
})

test('surface-host uses defineComponent and has section + main', async () => {
  const src = await readFile(resolve(shellDir, 'surface-host.html'), 'utf8')
  assert.match(src, /export\s+default\s+defineComponent\s*\(/)
  assert.match(src, /<section[^>]*class="surface__list"/)
  assert.match(src, /<main[^>]*class="surface__detail"/)
})
