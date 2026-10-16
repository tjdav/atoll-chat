// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createServer } from '../../../../src/server/index.js'
import { registerComposeRoute } from '../../../../src/server/routes/compose.js'

/**
 * Starts a server on an ephemeral port and returns its base URL.
 * @param {object} server - The server.
 * @returns {Promise<string>} The base URL.
 */
async function start (server) {
  const { port, host } = await server.listen(0)
  return `http://${host}:${port}`
}

/**
 * Sends a compose request.
 * @param {string} url - The base URL.
 * @param {object | string} body - The request body.
 * @returns {Promise<Response>} The HTTP response.
 */
async function post (url, body) {
  return fetch(`${url}/v1/compose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

/**
 * Creates a standard valid composition fixture.
 * @returns {object} A Composition object.
 */
function sampleComposition () {
  return Object.freeze({
    source: 'composed',
    target: 'bot',
    slots: {},
    handlers: {},
    capabilities: []
  })
}

/**
 * Creates valid request body fields.
 * @returns {object} Body fields.
 */
function validBody () {
  return {
    intent: 'make an echo bot',
    botId: 'com.example.echo',
    label: 'Echo Bot'
  }
}

test('registerComposeRoute validation - server argument', () => {
  assert.throws(
    () => registerComposeRoute(null, {}),
    /server must be an object/
  )
  assert.throws(
    () => registerComposeRoute({}, {}),
    /server\.addRoute must be a function/
  )
})

test('registerComposeRoute validation - deps argument', () => {
  const server = { addRoute: () => {} }
  assert.throws(
    () => registerComposeRoute(server, null),
    /deps must be an object/
  )
  assert.throws(
    () => registerComposeRoute(server, { composeBot: 'not-fn' }),
    /deps\.composeBot must be a function/
  )
  assert.throws(
    () => registerComposeRoute(server, { composeBot: () => {}, composeBotOptions: null }),
    /deps\.composeBotOptions must be an object/
  )
  assert.throws(
    () => registerComposeRoute(server, { composeBot: () => {}, composeBotOptions: {}, emit: null }),
    /deps\.emit must be a function/
  )
  assert.throws(
    () => registerComposeRoute(server, {
      composeBot: () => {},
      composeBotOptions: {},
      emit: () => {},
      llmProxyUrl: ''
    }),
    /deps\.llmProxyUrl must be a non-empty string when provided/
  )
  assert.throws(
    () => registerComposeRoute(server, {
      composeBot: () => {},
      composeBotOptions: {},
      emit: () => {},
      composerVersion: ''
    }),
    /deps\.composerVersion must be a non-empty string when provided/
  )
})

test('valid request where composeBot returns composed and emit returns string -> 200 composed', async () => {
  const composition = sampleComposition()
  let composeBotCalls = 0
  let emitCalls = 0

  const composeBot = async (intent, options) => {
    composeBotCalls++
    assert.equal(intent, 'make an echo bot')
    assert.deepEqual(options, { registry: 'fake-registry' })
    return { kind: 'composed', composition }
  }

  const emit = (comp, options) => {
    emitCalls++
    assert.equal(comp, composition)
    assert.equal(options.botId, 'com.example.echo')
    assert.equal(options.label, 'Echo Bot')
    return '// Emitted Bot Code'
  }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot,
    composeBotOptions: { registry: 'fake-registry' },
    emit
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 200)

  const data = await res.json()
  assert.equal(data.kind, 'composed')
  assert.equal(data.code, '// Emitted Bot Code')
  assert.deepEqual(data.composition, composition)

  assert.equal(composeBotCalls, 1)
  assert.equal(emitCalls, 1)

  await server.close()
})

test('valid request where composeBot returns refusal without errors -> 200 refusal', async () => {
  let composeBotCalls = 0
  let emitCalls = 0

  const composeBot = async () => {
    composeBotCalls++
    return {
      kind: 'refusal',
      reason: 'validation_failed',
      message: 'Failed to validate'
    }
  }

  const emit = () => {
    emitCalls++
    return ''
  }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot,
    composeBotOptions: {},
    emit
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 200)

  const data = await res.json()
  assert.equal(data.kind, 'refusal')
  assert.equal(data.reason, 'validation_failed')
  assert.equal(data.message, 'Failed to validate')
  assert.equal(Object.hasOwn(data, 'errors'), false)

  assert.equal(composeBotCalls, 1)
  assert.equal(emitCalls, 0)

  await server.close()
})

test('valid request where composeBot returns refusal with errors -> 200 refusal with errors', async () => {
  const errors = [{ code: 'invalid_shape', path: 'target', message: 'Target is required' }]

  const composeBot = async () => {
    return {
      kind: 'refusal',
      reason: 'validation_failed',
      message: 'Validation failed with errors',
      errors
    }
  }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot,
    composeBotOptions: {},
    emit: () => ''
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 200)

  const data = await res.json()
  assert.equal(data.kind, 'refusal')
  assert.equal(data.reason, 'validation_failed')
  assert.deepEqual(data.errors, errors)

  await server.close()
})

test('body missing intent -> 400 invalid_request', async () => {
  const body = validBody()
  delete body.intent

  const server = createServer()
  registerComposeRoute(server, {
    composeBot: async () => ({ kind: 'composed', composition: sampleComposition() }),
    composeBotOptions: {},
    emit: () => ''
  })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)

  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  assert.equal(data.message, 'intent is required')

  await server.close()
})

test('body with empty intent string -> 400 invalid_request', async () => {
  const body = { ...validBody(), intent: '' }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot: async () => ({ kind: 'composed', composition: sampleComposition() }),
    composeBotOptions: {},
    emit: () => ''
  })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)

  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  assert.equal(data.message, 'intent is required')

  await server.close()
})

test('body with non-string intent -> 400 invalid_request', async () => {
  const body = { ...validBody(), intent: 42 }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot: async () => ({ kind: 'composed', composition: sampleComposition() }),
    composeBotOptions: {},
    emit: () => ''
  })
  const url = await start(server)

  const res = await post(url, body)
  assert.equal(res.status, 400)

  const data = await res.json()
  assert.equal(data.error, 'invalid_request')
  assert.equal(data.message, 'intent is required')

  await server.close()
})

test('missing botId or label -> 400 invalid_request', async () => {
  const server = createServer()
  registerComposeRoute(server, {
    composeBot: async () => ({ kind: 'composed', composition: sampleComposition() }),
    composeBotOptions: {},
    emit: () => ''
  })
  const url = await start(server)

  const bodyNoBotId = { intent: 'test', label: 'Label' }
  const res1 = await post(url, bodyNoBotId)
  assert.equal(res1.status, 400)
  const data1 = await res1.json()
  assert.equal(data1.message, 'botId is required')

  const bodyNoLabel = { intent: 'test', botId: 'com.example.bot' }
  const res2 = await post(url, bodyNoLabel)
  assert.equal(res2.status, 400)
  const data2 = await res2.json()
  assert.equal(data2.message, 'label is required')

  await server.close()
})

test('body is not a JSON object -> 400 invalid_request', async () => {
  const server = createServer()
  registerComposeRoute(server, {
    composeBot: async () => ({ kind: 'composed', composition: sampleComposition() }),
    composeBotOptions: {},
    emit: () => ''
  })
  const url = await start(server)

  const res1 = await post(url, '"just a string"')
  assert.equal(res1.status, 400)
  const data1 = await res1.json()
  assert.equal(data1.message, 'Request body must be a JSON object')

  const res2 = await post(url, '[1, 2, 3]')
  assert.equal(res2.status, 400)
  const data2 = await res2.json()
  assert.equal(data2.message, 'Request body must be a JSON object')

  await server.close()
})

test('composeBot throws -> 500 internal_error', async () => {
  const composeBot = async () => {
    throw new Error('LLM service unavailable')
  }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot,
    composeBotOptions: {},
    emit: () => ''
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 500)

  const data = await res.json()
  assert.equal(data.error, 'internal_error')
  assert.equal(data.message, 'LLM service unavailable')

  await server.close()
})

test('emit throws -> 422 emit_failed', async () => {
  const composeBot = async () => ({ kind: 'composed', composition: sampleComposition() })
  const emit = () => {
    throw new Error('Unregistered primitive in composition')
  }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot,
    composeBotOptions: {},
    emit
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 422)

  const data = await res.json()
  assert.equal(data.error, 'emit_failed')
  assert.equal(data.message, 'Unregistered primitive in composition')

  await server.close()
})

test('passes llmProxyUrl and composerVersion to emit when set on deps', async () => {
  let emittedOptions = null

  const composeBot = async () => ({ kind: 'composed', composition: sampleComposition() })
  const emit = (comp, options) => {
    emittedOptions = options
    return '// code'
  }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot,
    composeBotOptions: {},
    emit,
    llmProxyUrl: 'https://proxy.example.com/v1/llm',
    composerVersion: '1.2.3'
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 200)

  assert.equal(emittedOptions.llmProxyUrl, 'https://proxy.example.com/v1/llm')
  assert.equal(emittedOptions.composerVersion, '1.2.3')
  assert.equal(emittedOptions.botId, 'com.example.echo')
  assert.equal(emittedOptions.label, 'Echo Bot')

  await server.close()
})

test('does not pass llmProxyUrl or composerVersion to emit when not set on deps', async () => {
  let emittedOptions = null

  const composeBot = async () => ({ kind: 'composed', composition: sampleComposition() })
  const emit = (comp, options) => {
    emittedOptions = options
    return '// code'
  }

  const server = createServer()
  registerComposeRoute(server, {
    composeBot,
    composeBotOptions: {},
    emit
  })
  const url = await start(server)

  const res = await post(url, validBody())
  assert.equal(res.status, 200)

  assert.equal(Object.hasOwn(emittedOptions, 'llmProxyUrl'), false)
  assert.equal(Object.hasOwn(emittedOptions, 'composerVersion'), false)

  await server.close()
})
