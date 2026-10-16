// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { completeComposition } from '../../../src/composer/llm.js'

/**
 * Creates valid default options for tests.
 * @param {object} [overrides] - Override fields.
 * @returns {import('../../../src/types.js').ComposerLlmOptions} Options bag.
 */
function defaultOptions (overrides = {}) {
  return {
    upstreamUrl: 'http://localhost:3000/v1/llm/complete',
    apiKey: 'test-key',
    model: 'gpt-4o',
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ source: 'composed', target: 'bot' })
            }
          }
        ]
      })
    }),
    ...overrides
  }
}

/**
 * Standard test messages array.
 * @returns {import('../../../src/types.js').ComposerMessage[]} Messages.
 */
function defaultMessages () {
  return [
    { role: 'system', content: 'You are the composer.' },
    { role: 'user', content: 'Create a bot' }
  ]
}

test('throws TypeError on missing required options or invalid types', async () => {
  await assert.rejects(
    () => completeComposition('not-an-array', defaultOptions()),
    /messages must be an array/
  )
  await assert.rejects(
    () => completeComposition(defaultMessages(), null),
    /options must be an object/
  )
  await assert.rejects(
    () => completeComposition(defaultMessages(), defaultOptions({ upstreamUrl: '' })),
    /options\.upstreamUrl must be a non-empty string/
  )
  await assert.rejects(
    () => completeComposition(defaultMessages(), defaultOptions({ apiKey: '' })),
    /options\.apiKey must be a non-empty string/
  )
  await assert.rejects(
    () => completeComposition(defaultMessages(), defaultOptions({ model: '' })),
    /options\.model must be a non-empty string/
  )
  await assert.rejects(
    () => completeComposition(defaultMessages(), defaultOptions({ fetch: 'not-a-fn' })),
    /options\.fetch must be a function/
  )
  await assert.rejects(
    () => completeComposition(defaultMessages(), defaultOptions({ timeoutMs: -10 })),
    /options\.timeoutMs must be a positive number/
  )
  await assert.rejects(
    () => completeComposition(defaultMessages(), defaultOptions({ temperature: 'hot' })),
    /options\.temperature must be a number/
  )
})

test('successful call returns ok: true, content, and parsed object', async () => {
  const messages = defaultMessages()
  const options = defaultOptions()

  const result = await completeComposition(messages, options)

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(typeof result.content, 'string')
    assert.deepEqual(result.parsed, { source: 'composed', target: 'bot' })
  }
})

test('valid request structure, headers, and temperature option sent to fetch', async () => {
  let capturedUrl = ''
  let capturedInit = {}

  const messages = defaultMessages()
  const options = defaultOptions({
    temperature: 0.2,
    fetch: async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }]
        })
      }
    }
  })

  await completeComposition(messages, options)

  assert.equal(capturedUrl, 'http://localhost:3000/v1/llm/complete')
  assert.equal(capturedInit.method, 'POST')
  assert.equal(capturedInit.headers['content-type'], 'application/json')
  assert.equal(capturedInit.headers.authorization, 'Bearer test-key')

  const body = JSON.parse(capturedInit.body)
  assert.equal(body.model, 'gpt-4o')
  assert.deepEqual(body.messages, messages)
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.equal(body.temperature, 0.2)
})

test('temperature field is omitted from request body when undefined', async () => {
  let capturedInit = {}

  const messages = defaultMessages()
  const options = defaultOptions({
    temperature: undefined,
    fetch: async (url, init) => {
      capturedInit = init
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }]
        })
      }
    }
  })

  await completeComposition(messages, options)

  const body = JSON.parse(capturedInit.body)
  assert.equal(Object.hasOwn(body, 'temperature'), false)
})

test('returns upstream_unreachable when fetch throws a generic Error or primitive', async () => {
  const errOptions = defaultOptions({
    fetch: async () => {
      throw new Error('Connection refused')
    }
  })
  const res = await completeComposition(defaultMessages(), errOptions)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'upstream_unreachable')
    assert.match(res.error.message, /Connection refused/)
  }

  const primOptions = defaultOptions({
    fetch: async () => {
      throw 'Network string error'
    }
  })
  const resPrim = await completeComposition(defaultMessages(), primOptions)
  assert.equal(resPrim.ok, false)
  if (!resPrim.ok) {
    assert.equal(resPrim.error.code, 'upstream_unreachable')
    assert.match(resPrim.error.message, /Network string error/)
  }
})

test('returns upstream_timeout when call times out', async () => {
  const timeoutOptions = defaultOptions({
    timeoutMs: 10,
    fetch: async (url, init) => {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }
  })

  const res = await completeComposition(defaultMessages(), timeoutOptions)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'upstream_timeout')
    assert.match(res.error.message, /timed out after 10ms/)
  }
})

test('returns upstream_error when response status is non-2xx', async () => {
  const options = defaultOptions({
    fetch: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' })
    })
  })

  const res = await completeComposition(defaultMessages(), options)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'upstream_error')
    assert.equal(res.error.status, 500)
    assert.match(res.error.message, /status 500/)
  }
})

test('returns upstream_invalid_json when response body is not valid JSON', async () => {
  const options = defaultOptions({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      }
    })
  })

  const res = await completeComposition(defaultMessages(), options)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'upstream_invalid_json')
  }
})

test('returns upstream_malformed when choices[0].message.content is missing or not a string', async () => {
  const noChoicesOptions = defaultOptions({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] })
    })
  })
  const res1 = await completeComposition(defaultMessages(), noChoicesOptions)
  assert.equal(res1.ok, false)
  if (!res1.ok) {
    assert.equal(res1.error.code, 'upstream_malformed')
  }

  const nonStringContentOptions = defaultOptions({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 12345 } }] })
    })
  })
  const res2 = await completeComposition(defaultMessages(), nonStringContentOptions)
  assert.equal(res2.ok, false)
  if (!res2.ok) {
    assert.equal(res2.error.code, 'upstream_malformed')
  }
})

test('returns invalid_json_content when response content is not valid JSON', async () => {
  const options = defaultOptions({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Sorry, I cannot create that composition.' } }]
      })
    })
  })

  const res = await completeComposition(defaultMessages(), options)
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'invalid_json_content')
    assert.match(res.error.message, /not valid JSON/)
  }
})

test('input messages array is not mutated', async () => {
  const originalMessages = Object.freeze([
    Object.freeze({ role: 'system', content: 'system prompt' }),
    Object.freeze({ role: 'user', content: 'user intent' })
  ])

  const options = defaultOptions()
  const res = await completeComposition(originalMessages, options)
  assert.equal(res.ok, true)
  assert.equal(originalMessages.length, 2)
  assert.equal(originalMessages[0].role, 'system')
})

test('deterministic stub produces deeply equal results across multiple calls', async () => {
  const messages = defaultMessages()
  const options = defaultOptions()

  const res1 = await completeComposition(messages, options)
  const res2 = await completeComposition(messages, options)

  assert.deepEqual(res1, res2)
})
