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

test('no internal data-* attributes in component templates except data-testid', async () => {
  const offenders = []
  for await (const file of walkHtml(root)) {
    const source = await readFile(file, 'utf8')
    const templateMatch = source.match(/<template\s+id="[^"]+">([\s\S]*?)<\/template>/)
    if (!templateMatch) continue
    const template = templateMatch[1]
    if (template.includes('coralite-ignore-data-attributes')) continue
    const matches = [...template.matchAll(/\bdata-([a-z][a-z0-9-]*)\b/g)].map((m) => m[1])
    const badMatches = matches.filter((name) => name !== 'testid')
    if (badMatches.length) {
      const relPath = relative(root, file).split(sep).join('/')
      offenders.push(`${relPath} — ${[...new Set(badMatches)].join(', ')}`)
    }
  }
  assert.deepEqual(offenders, [], `Components with internal data-* attributes: ${offenders.join(' | ')}`)
})
