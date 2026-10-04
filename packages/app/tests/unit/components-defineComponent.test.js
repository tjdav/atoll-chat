/**
 * Unit test asserting every component HTML file under src/components/
 * with a script module default export uses defineComponent from 'coralite'.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../../src/components')

async function* walkHtml(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkHtml(full)
    else if (entry.isFile() && entry.name.endsWith('.html')) yield full
  }
}

test('every component script that exports default must wrap in defineComponent', async () => {
  const offenders = []
  for await (const file of walkHtml(root)) {
    const source = await readFile(file, 'utf8')
    const hasScript = /<script\s+type="module"/.test(source)
    if (!hasScript) continue
    const exportsDefault = /export\s+default\b/.test(source)
    if (!exportsDefault) continue
    const importsDefine = /import\s*\{[^}]*\bdefineComponent\b[^}]*\}\s*from\s*['"]coralite['"]/.test(source)
    const callsDefine = /export\s+default\s+defineComponent\s*\(/.test(source)
    if (!importsDefine || !callsDefine) {
      offenders.push(relative(root, file).split(sep).join('/'))
    }
  }
  assert.deepEqual(offenders, [], `Components missing defineComponent wrapper: ${offenders.join(', ')}`)
})
