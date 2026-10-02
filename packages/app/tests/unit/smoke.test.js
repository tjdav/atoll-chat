import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = join(here, '..', '..', 'package.json')

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, 'utf8'))
}

test('coralite is pinned at 1.0.0-rc.5', async () => {
  const pkg = await readPackageJson()
  assert.equal(pkg.devDependencies.coralite, '1.0.0-rc.5')
})

test('coralite-scripts is pinned at 1.0.0-rc.5', async () => {
  const pkg = await readPackageJson()
  assert.equal(pkg.devDependencies['coralite-scripts'], '1.0.0-rc.5')
})

test('node engine floor is >=24.0.0', async () => {
  const pkg = await readPackageJson()
  assert.equal(pkg.engines.node, '>=24.0.0')
})
