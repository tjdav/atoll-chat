import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, '../..')

test('CSS bundle output', async (t) => {
  await t.test('production build produces flat CSS bundle without @import statements', () => {
    // Run production build
    const buildResult = spawnSync('pnpm', ['--filter', '@atoll/app', 'build'], {
      cwd: appRoot,
      encoding: 'utf8',
      shell: true
    })

    assert.equal(
      buildResult.status,
      0,
      `Build failed with exit code ${buildResult.status}: ${buildResult.stderr}`
    )

    const cssPath = resolve(appRoot, 'dist/assets/css/main.css')
    assert.ok(existsSync(cssPath), `Expected CSS bundle file at ${cssPath}`)

    const css = readFileSync(cssPath, 'utf8')

    // 1. File size threshold assertion (> 500 bytes)
    assert.ok(
      css.length > 500,
      `Built CSS file is too small (${css.length} bytes), expected > 500 bytes.`
    )

    // 2. Asserts no @import statements remain
    assert.ok(
      !/(^|\n)\s*@import\b/.test(css),
      'Built CSS still contains @import — postcss-import is not running.'
    )

    // 3. Asserts presence of representative token rules
    assert.ok(css.includes('--accent-500'), 'Expected --accent-500 in bundled CSS.')
    assert.ok(css.includes('--surface-0'), 'Expected --surface-0 in bundled CSS.')
    assert.ok(css.includes('--rail-width'), 'Expected --rail-width in bundled CSS.')

    // 4. Asserts presence of layer declarations
    assert.ok(css.includes('@layer tokens'), 'Expected @layer tokens in bundled CSS.')
    assert.ok(css.includes('@layer base'), 'Expected @layer base in bundled CSS.')
  })
})
