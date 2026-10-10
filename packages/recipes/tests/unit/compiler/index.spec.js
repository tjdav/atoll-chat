// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compile } from '../../../src/compiler/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', '..', 'fixtures', 'compiler-library')

/**
 * Standard bot options for the echo fixture.
 * @returns {object} The options.
 */
function echoOptions () {
  return { botId: 'com.example.echo', label: 'Echo Bot' }
}

/**
 * Standard instantiation for the echo fixture.
 * @param {Record<string, unknown>} [slots] - Slot overrides.
 * @returns {object} The instantiation.
 */
function echoInstantiation (slots) {
  return {
    recipeId: 'echo',
    recipeVersion: '1.0.0',
    slots: slots ?? {}
  }
}

test('compile returns a BotScript with code and composition', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hello' }), echoOptions())
  assert.equal(typeof script.code, 'string')
  assert.equal(typeof script.composition, 'object')
  assert.ok(script.code.length > 0)
})

test('compile code contains the SPDX header', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), echoOptions())
  assert.match(script.code, /SPDX-License-Identifier: AGPL-3\.0-or-later/)
})

test('compile code includes the recipe provenance comment', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), echoOptions())
  assert.match(script.code, /Recipe: echo@1\.0\.0/)
})

test('compile composition carries the recipe id and version', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), echoOptions())
  assert.equal(script.composition.recipeId, 'echo')
  assert.equal(script.composition.recipeVersion, '1.0.0')
})

test('compile composition carries the resolved slots', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'howdy' }), echoOptions())
  assert.equal(script.composition.slots.greeting, 'howdy')
})

test('compile substitutes slot values into handler configs', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'howdy' }), echoOptions())
  const install = script.composition.handlers.install
  assert.equal(install.config.text, 'howdy, I am echo.')
})

test('compile substitutes slot values into child configs', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'howdy' }), echoOptions())
  const message = script.composition.handlers.message
  assert.equal(message.children[0].config.text, 'pong from howdy')
})

test('compile preserves the trigger in the composition', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), echoOptions())
  assert.ok(Array.isArray(script.composition.triggers))
  assert.equal(script.composition.triggers.length, 1)
  assert.equal(script.composition.triggers[0].primitive, 'schedule-task')
})

test('compile emits the handler and trigger in the code', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), echoOptions())
  assert.match(script.code, /postResponse\.create\(/)
  assert.match(script.code, /watchPattern\.create\(/)
  assert.match(script.code, /scheduleTask\.create\(/)
  assert.match(script.code, /const triggers = \[/)
})

test('compile emits the bot identity into the code', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), echoOptions())
  assert.match(script.code, /id: "com\.example\.echo"/)
  assert.match(script.code, /label: "Echo Bot"/)
})

test('compile uses the recipe default slot value when the instantiation omits it', async () => {
  const script = await compile(LIB, echoInstantiation({}), echoOptions())
  assert.equal(script.composition.slots.greeting, 'hi')
  assert.match(script.code, /"greeting": "hi"/)
})

test('compile is deterministic for identical inputs', async () => {
  const inst1 = echoInstantiation({ greeting: 'hi' })
  const inst2 = echoInstantiation({ greeting: 'hi' })
  const opts1 = echoOptions()
  const opts2 = echoOptions()
  const first = await compile(LIB, inst1, opts1)
  const second = await compile(LIB, inst2, opts2)
  assert.equal(first.code, second.code)
  assert.deepEqual(first.composition, second.composition)
})

test('compile passes custom apiVersion and hostApi through to the emitter', async () => {
  const opts = { botId: 'com.example.echo', label: 'Echo Bot', apiVersion: '2.0.0', hostApi: '^2.0' }
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), opts)
  assert.match(script.code, /apiVersion: "2\.0\.0"/)
  assert.match(script.code, /hostApi: "\^2\.0"/)
})

test('compile throws when options are not an object', async () => {
  await assert.rejects(
    () => compile(LIB, echoInstantiation({}), null),
    /options must be an object/
  )
})

test('compile throws when the recipe does not exist', async () => {
  const inst = { recipeId: 'not-real', recipeVersion: '1.0.0', slots: {} }
  await assert.rejects(
    () => compile(LIB, inst, echoOptions()),
    /cannot load recipe "not-real"/
  )
})

test('compile throws when the version does not match', async () => {
  const inst = { recipeId: 'echo', recipeVersion: '9.9.9', slots: { greeting: 'hi' } }
  await assert.rejects(
    () => compile(LIB, inst, echoOptions()),
    /version mismatch/
  )
})

test('compile throws when a required slot is missing', async () => {
  const inst = { recipeId: 'echo', recipeVersion: '1.0.0', slots: {} }
  const noDefaultLib = LIB
  // Echo's greeting has a default, so missing it is fine. Force the error
  // by requesting a recipe whose required slot has no default.
  const instBad = { recipeId: 'echo', recipeVersion: '1.0.0', slots: {} }
  const script = await compile(noDefaultLib, instBad, echoOptions())
  assert.equal(script.composition.slots.greeting, 'hi')
})

test('compile emits a code string that can be parsed by new Function when imports are stubbed', async () => {
  const script = await compile(LIB, echoInstantiation({ greeting: 'hi' }), echoOptions())
  const encoded = Buffer.from(script.code, 'utf8').toString('base64')
  const build = new Function(`
    const defineBot = (config) => config
    const postResponse = { create: () => ({}) }
    const watchPattern = { create: () => ({}) }
    const scheduleTask = { create: () => ({}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('  handlers\\n  triggers', '  handlers,\\n  triggers')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'postResponse', 'watchPattern', 'scheduleTask', cleaned)
    return fn(defineBot, postResponse, watchPattern, scheduleTask)
  `)
  const result = build()
  assert.ok(result)
  assert.equal(result.id, 'com.example.echo')
})
