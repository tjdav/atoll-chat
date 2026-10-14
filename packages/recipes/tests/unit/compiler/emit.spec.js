// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emit } from '../../../src/compiler/emit.js'

/**
 * A minimal composition with a single post-response handler.
 * @returns {object} The composition.
 */
function simpleComposition () {
  return {
    source: 'recipe',
    recipeId: 'inline',
    recipeVersion: '1.0.0',
    target: 'bot',
    slots: {},
    capabilities: ['post_message'],
    handlers: {
      install: {
        id: 'install-hook',
        primitive: 'post-response',
        config: { text: 'Hello.' }
      }
    }
  }
}

/**
 * A composition with nested children.
 * @returns {object} The composition.
 */
function nestedComposition () {
  return {
    recipeId: 'delta',
    recipeVersion: '1.0.0',
    target: 'bot',
    slots: { prefix: 'p' },
    capabilities: ['read_content'],
    handlers: {
      message: {
        id: 'watch',
        primitive: 'watch-pattern',
        config: { pattern: 'url' },
        children: [
          {
            id: 'store',
            primitive: 'keyed-store',
            config: { key: 'k:{{match}}' }
          }
        ]
      }
    }
  }
}

/**
 * Standard bot options.
 * @returns {object} The options.
 */
function standardOptions () {
  return { botId: 'com.example.bot', label: 'Example Bot' }
}

test('emit returns a string', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.equal(typeof output, 'string')
  assert.ok(output.length > 0)
})

test('emit includes the SPDX header', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /SPDX-License-Identifier: AGPL-3\.0-or-later/)
})

test('emit includes the recipe provenance comment', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /Recipe: inline@1\.0\.0/)
})

test('emit imports defineBot from @atoll/bot', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /import \{ defineBot \} from '@atoll\/bot'/)
})

test('emit imports primitives from @atoll/recipes/primitives', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /from '@atoll\/recipes\/primitives'/)
})

test('emit sorts imports alphabetically', () => {
  const composition = nestedComposition()
  composition.handlers.install = {
    id: 'install',
    primitive: 'post-response',
    config: { text: 'hi' }
  }
  const output = emit(composition, standardOptions())
  const importBlock = output.match(/import \{([\s\S]*?)\} from '@atoll\/recipes\/primitives'/)
  assert.ok(importBlock)
  const names = importBlock[1].split(',').map((s) => s.trim()).filter(Boolean)
  const sorted = [...names].sort()
  assert.deepEqual(names, sorted)
})

test('emit calls .create on each primitive', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /postResponse\.create\(/)
})

test('emit passes the config to .create', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /"text": "Hello\."/)
})

test('emit nests children in the create call', () => {
  const output = emit(nestedComposition(), standardOptions())
  assert.match(output, /watchPattern\.create\(/)
  assert.match(output, /keyedStore\.create\(/)
})

test('emit preserves double-brace tokens in the emitted config', () => {
  const output = emit(nestedComposition(), standardOptions())
  assert.match(output, /k:\{\{match\}\}/)
})

test('emit includes the bot id, label, apiVersion, hostApi', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /id: "com\.example\.bot"/)
  assert.match(output, /label: "Example Bot"/)
  assert.match(output, /apiVersion: "1\.0\.0"/)
  assert.match(output, /hostApi: "\^1\.0"/)
})

test('emit includes the capabilities from the composition', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /"post_message"/)
})

test('emit uses custom apiVersion and hostApi when provided', () => {
  const opts = { ...standardOptions(), apiVersion: '2.0.0', hostApi: '^2.0' }
  const output = emit(simpleComposition(), opts)
  assert.match(output, /apiVersion: "2\.0\.0"/)
  assert.match(output, /hostApi: "\^2\.0"/)
})

test('emit includes the avatar when provided', () => {
  const opts = { ...standardOptions(), avatar: { emoji: '🔖' } }
  const output = emit(simpleComposition(), opts)
  assert.match(output, /avatar:/)
  assert.match(output, /🔖/)
})

test('emit omits the avatar when not provided', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.doesNotMatch(output, /avatar:/)
})

test('emit includes the slots constant', () => {
  const composition = nestedComposition()
  const output = emit(composition, standardOptions())
  assert.match(output, /const slots = \{/)
  assert.match(output, /"prefix": "p"/)
})

test('emit includes the handlers constant', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /const handlers = \{/)
  assert.match(output, /install:/)
})

test('emit includes the triggers block when triggers exist', () => {
  const composition = simpleComposition()
  composition.triggers = [
    {
      id: 'schedule',
      primitive: 'schedule-task',
      config: { name: 'daily', cron: '0 9 * * *' }
    }
  ]
  const output = emit(composition, standardOptions())
  assert.match(output, /const triggers = \[/)
  assert.match(output, /scheduleTask\.create\(/)
})

test('emit omits the triggers block when no triggers exist', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.doesNotMatch(output, /const triggers = \[/)
})

test('emit produces valid JavaScript when handlers and triggers are both present', () => {
  const composition = simpleComposition()
  composition.triggers = [
    {
      id: 'schedule',
      primitive: 'schedule-task',
      config: { name: 'daily', cron: '0 9 * * *' }
    }
  ]
  const output = emit(composition, standardOptions())

  const encoded = Buffer.from(output, 'utf8').toString('base64')
  const build = new Function(`
    const defineBot = (config) => config
    const postResponse = { create: () => ({}) }
    const scheduleTask = { create: () => ({}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'postResponse', 'scheduleTask', cleaned)
    return fn(defineBot, postResponse, scheduleTask)
  `)
  const result = build()
  assert.ok(result)
  assert.ok(Object.hasOwn(result, 'handlers'))
  assert.ok(Object.hasOwn(result, 'triggers'))
})

test('emit exports default defineBot', () => {
  const output = emit(simpleComposition(), standardOptions())
  assert.match(output, /export default defineBot\(\{/)
})

test('emit is deterministic', () => {
  const c1 = nestedComposition()
  const c2 = nestedComposition()
  const o1 = standardOptions()
  const o2 = standardOptions()
  assert.equal(emit(c1, o1), emit(c2, o2))
})

test('emit throws when the composition is not an object', () => {
  assert.throws(() => emit(null, standardOptions()), /composition must be an object/)
  assert.throws(() => emit('x', standardOptions()), /composition must be an object/)
})

test('emit throws when the options are not an object', () => {
  assert.throws(() => emit(simpleComposition(), null), /options must be an object/)
})

test('emit throws when botId is missing', () => {
  assert.throws(
    () => emit(simpleComposition(), { label: 'x' }),
    /options\.botId must be a non-empty string/
  )
})

test('emit throws when label is missing', () => {
  assert.throws(
    () => emit(simpleComposition(), { botId: 'x' }),
    /options\.label must be a non-empty string/
  )
})

test('emit throws when the avatar is not an object', () => {
  assert.throws(
    () => emit(simpleComposition(), { ...standardOptions(), avatar: '🔖' }),
    /options\.avatar must be a plain object/
  )
})

test('emit throws when a primitive is not registered', () => {
  const composition = simpleComposition()
  composition.handlers.install.primitive = 'not-real'
  assert.throws(
    () => emit(composition, standardOptions()),
    /primitive "not-real" is not registered/
  )
})

test('emit output parses as valid JavaScript', () => {
  const output = emit(nestedComposition(), standardOptions())
  const encoded = Buffer.from(output, 'utf8').toString('base64')
  const parsed = new Function(`
    const { defineBot } = { defineBot: (config) => config }
    const postResponse = { create: () => ({}) }
    const watchPattern = { create: () => ({}) }
    const keyedStore = { create: () => ({}) }
    return async function run() {
      const module = { exports: {} }
      const src = Buffer.from('${encoded}', 'base64').toString('utf8')
      const rewritten = src
        .replace("import { defineBot } from '@atoll/bot'", '')
        .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
        .replace('export default defineBot', 'return defineBot')
      const fn = new Function('defineBot', 'postResponse', 'watchPattern', 'keyedStore', rewritten)
      return fn(defineBot, postResponse, watchPattern, keyedStore)
    }
  `)
  assert.ok(parsed)
})

test('emit produces a commands block when the composition has commands', () => {
  const composition = simpleComposition()
  composition.commands = {
    save: {
      id: 'save-command',
      primitive: 'expose-command',
      config: {
        name: 'save',
        description: 'Save an item.',
        args: { url: { type: 'string', required: true } }
      },
      children: [
        {
          id: 'save-respond',
          primitive: 'post-response',
          config: { text: 'Saved.' }
        }
      ]
    }
  }
  const code = emit(composition, standardOptions())
  assert.match(code, /const commands = \{/)
  assert.match(code, /asCommandDecl\(/)
  assert.match(code, /"save"/)
  assert.match(code, /"Save an item\."/)
  assert.match(code, /"url"/)
})

test('emit imports asCommandDecl when commands are present', () => {
  const composition = simpleComposition()
  composition.commands = {
    save: {
      id: 'save-command',
      primitive: 'expose-command',
      config: { name: 'save' },
      children: [{ id: 'save-respond', primitive: 'post-response', config: { text: 'ok' } }]
    }
  }
  const code = emit(composition, standardOptions())
  assert.match(code, /asCommandDecl/)
})

test('emit omits the commands block when no commands are present', () => {
  const code = emit(simpleComposition(), standardOptions())
  assert.doesNotMatch(code, /const commands = \{/)
  assert.doesNotMatch(code, /asCommandDecl/)
})

test('emit produces valid JavaScript when commands, handlers, and triggers are all present', () => {
  const composition = simpleComposition()
  composition.commands = {
    save: {
      id: 'save-command',
      primitive: 'expose-command',
      config: { name: 'save', description: 'Save it.' },
      children: [{ id: 'save-respond', primitive: 'post-response', config: { text: 'ok' } }]
    }
  }
  composition.triggers = [
    { id: 'schedule', primitive: 'schedule-task', config: { name: 'daily', cron: '0 9 * * *' } }
  ]
  const code = emit(composition, standardOptions())

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const build = new Function(`
    const defineBot = (config) => config
    const asCommandDecl = (name, description, args, handler) => ({ name, description, args, handler })
    const exposeCommand = { create: () => (() => {}) }
    const postResponse = { create: () => (() => {}) }
    const scheduleTask = { create: () => (() => {}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'asCommandDecl', 'exposeCommand', 'postResponse', 'scheduleTask', cleaned)
    return fn(defineBot, asCommandDecl, exposeCommand, postResponse, scheduleTask)
  `)
  const result = build()
  assert.ok(result)
  assert.ok(result.commands)
  assert.ok(result.handlers)
  assert.ok(result.triggers)
})

test('emit includes a settings block when the composition has settings', () => {
  const composition = simpleComposition()
  composition.settings = {
    greeting: {
      label: 'Greeting',
      type: 'text',
      scope: 'user',
      default: 'hello'
    }
  }
  const code = emit(composition, standardOptions())
  assert.match(code, /settings: \{/)
  assert.match(code, /"greeting"/)
  assert.match(code, /"Greeting"/)
})

test('emit omits settings when the composition has none', () => {
  const code = emit(simpleComposition(), standardOptions())
  assert.doesNotMatch(code, /settings:/)
})

test('emit produces valid JavaScript when settings, commands, handlers, and triggers are all present', () => {
  const composition = simpleComposition()
  composition.settings = {
    greeting: { label: 'Greeting', type: 'text', default: 'hi' }
  }
  composition.commands = {
    save: {
      id: 'save-command',
      primitive: 'expose-command',
      config: { name: 'save' },
      children: [{ id: 'save-respond', primitive: 'post-response', config: { text: 'ok' } }]
    }
  }
  composition.triggers = [
    { id: 'schedule', primitive: 'schedule-task', config: { name: 'daily', cron: '0 9 * * *' } }
  ]
  const code = emit(composition, standardOptions())

  const encoded = Buffer.from(code, 'utf8').toString('base64')
  const build = new Function(`
    const defineBot = (config) => config
    const asCommandDecl = (name, description, argsDecl, handler) => ({ name, description, argsDecl, handler })
    const exposeCommand = { create: () => (() => {}) }
    const postResponse = { create: () => (() => {}) }
    const scheduleTask = { create: () => (() => {}) }
    const src = Buffer.from('${encoded}', 'base64').toString('utf8')
    const cleaned = src
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/bot'/, '')
      .replace(/import \\{[\\s\\S]*?\\} from '@atoll\\/recipes\\/primitives'/, '')
      .replace('export default defineBot', 'return defineBot')
    const fn = new Function('defineBot', 'asCommandDecl', 'exposeCommand', 'postResponse', 'scheduleTask', cleaned)
    return fn(defineBot, asCommandDecl, exposeCommand, postResponse, scheduleTask)
  `)
  const result = build()
  assert.ok(result)
  assert.ok(result.settings)
  assert.ok(result.commands)
  assert.ok(result.handlers)
  assert.ok(result.triggers)
})

test('emit injects baseUrl for llm-complete when llmProxyUrl is set', () => {
  const composition = simpleComposition()
  composition.handlers.ask = {
    id: 'ask-hook',
    primitive: 'llm-complete',
    config: {
      model: 'test-model',
      userPrompt: 'Hello.'
    }
  }
  const code = emit(composition, {
    ...standardOptions(),
    llmProxyUrl: 'https://engine.example.com/v1/llm/complete'
  })
  assert.match(code, /llmComplete\.create\(/)
  assert.match(code, /"baseUrl": "https:\/\/engine\.example\.com\/v1\/llm\/complete"/)
})

test('emit does not inject baseUrl when the recipe already sets it', () => {
  const composition = simpleComposition()
  composition.handlers.ask = {
    id: 'ask-hook',
    primitive: 'llm-complete',
    config: {
      baseUrl: 'https://custom.example.com/llm',
      model: 'test-model',
      userPrompt: 'Hello.'
    }
  }
  const code = emit(composition, {
    ...standardOptions(),
    llmProxyUrl: 'https://engine.example.com/v1/llm/complete'
  })
  assert.match(code, /"baseUrl": "https:\/\/custom\.example\.com\/llm"/)
  assert.doesNotMatch(code, /engine\.example\.com/)
})

test('emit does not inject baseUrl when llmProxyUrl is not set', () => {
  const composition = simpleComposition()
  composition.handlers.ask = {
    id: 'ask-hook',
    primitive: 'llm-complete',
    config: {
      baseUrl: 'https://provided.example.com/llm',
      model: 'test-model',
      userPrompt: 'Hello.'
    }
  }
  const code = emit(composition, standardOptions())
  assert.match(code, /"baseUrl": "https:\/\/provided\.example\.com\/llm"/)
})

test('emit injects baseUrl into llm-complete instances nested as children', () => {
  const composition = simpleComposition()
  composition.commands = {
    ask: {
      id: 'ask-cmd',
      primitive: 'expose-command',
      config: { name: 'ask' },
      children: [
        {
          id: 'ask-inner',
          primitive: 'llm-complete',
          config: {
            model: 'test-model',
            userPrompt: '{{args.q}}'
          }
        }
      ]
    }
  }
  const code = emit(composition, {
    ...standardOptions(),
    llmProxyUrl: 'https://engine.example.com/v1/llm/complete'
  })
  assert.match(code, /"baseUrl": "https:\/\/engine\.example\.com\/v1\/llm\/complete"/)
})

test('emit throws when llmProxyUrl is not a non-empty string', () => {
  assert.throws(
    () => emit(simpleComposition(), { ...standardOptions(), llmProxyUrl: '' }),
    /options\.llmProxyUrl must be a non-empty string when provided/
  )
  assert.throws(
    () => emit(simpleComposition(), { ...standardOptions(), llmProxyUrl: 42 }),
    /options\.llmProxyUrl must be a non-empty string when provided/
  )
})

test('emit leaves other primitives untouched when llmProxyUrl is set', () => {
  const code = emit(simpleComposition(), {
    ...standardOptions(),
    llmProxyUrl: 'https://engine.example.com/v1/llm/complete'
  })
  assert.doesNotMatch(code, /"baseUrl": "https:\/\/engine\.example\.com/)
})

test('emit writes a Recipe provenance header for recipe compositions', () => {
  const code = emit(simpleComposition(), standardOptions())
  assert.match(code, /\/\/ Recipe: inline@1\.0\.0/)
  assert.doesNotMatch(code, /\/\/ Composed:/)
})

test('emit writes a Composed provenance header for composed compositions', () => {
  const composition = simpleComposition()
  delete composition.recipeId
  delete composition.recipeVersion
  composition.source = 'composed'
  const code = emit(composition, standardOptions())
  assert.match(code, /\/\/ Composed: unknown/)
  assert.doesNotMatch(code, /\/\/ Recipe:/)
})

test('emit uses options.composerVersion in the composed header when provided', () => {
  const composition = simpleComposition()
  delete composition.recipeId
  delete composition.recipeVersion
  composition.source = 'composed'
  const code = emit(composition, { ...standardOptions(), composerVersion: '2.1.0' })
  assert.match(code, /\/\/ Composed: 2\.1\.0/)
})

test('emit throws when composerVersion is not a non-empty string', () => {
  assert.throws(
    () => emit(simpleComposition(), { ...standardOptions(), composerVersion: '' }),
    /options\.composerVersion must be a non-empty string when provided/
  )
  assert.throws(
    () => emit(simpleComposition(), { ...standardOptions(), composerVersion: 42 }),
    /options\.composerVersion must be a non-empty string when provided/
  )
})
