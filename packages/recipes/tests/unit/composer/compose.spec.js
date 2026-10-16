// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { composeBot } from '../../../src/composer/compose.js'

function createStubRegistry () {
  return {
    getPrimitive (target, id) {
      if (id === 'post-response') {
        return {
          id: 'post-response',
          targets: ['bot'],
          capabilities: ['post_message'],
          label: 'Post Response',
          description: 'Posts a response message.',
          configSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text']
          }
        }
      }
      return undefined
    },
    listPrimitives (target) {
      return ['post-response']
    }
  }
}

function createStubLibrary () {
  return [
    { id: 'echo', label: 'Echo', description: 'Echoes back received messages.' }
  ]
}

function createValidCompositionResponse (extra = {}) {
  const comp = {
    source: 'composed',
    target: 'bot',
    slots: {},
    handlers: {
      message: {
        id: 'msg-1',
        primitive: 'post-response',
        config: { text: 'Hello world' }
      }
    },
    capabilities: ['post_message'],
    ...extra
  }
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(comp)
        }
      }
    ]
  }
}

function createInvalidCompositionResponse () {
  const comp = {
    source: 'composed',
    target: 'bot',
    slots: {},
    handlers: {
      message: {
        id: 'msg-1',
        primitive: 'post-response',
        config: {}
      }
    },
    capabilities: []
  }
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(comp)
        }
      }
    ]
  }
}

describe('composeBot', () => {
  it('succeeds on first attempt and returns deeply frozen composition', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    let fetchCount = 0

    const fetchStub = async () => {
      fetchCount++
      return {
        ok: true,
        json: async () => createValidCompositionResponse()
      }
    }

    const result = await composeBot('echo messages', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(fetchCount, 1)
    assert.equal(result.kind, 'composed')
    assert.equal(result.composition.source, 'composed')
    assert.equal(Object.isFrozen(result.composition), true)
    assert.equal(Object.isFrozen(result.composition.handlers.message), true)
    assert.equal(Object.isFrozen(result.composition.handlers.message.config), true)
  })

  it('succeeds on second attempt when first attempt fails validation', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    let fetchCount = 0
    const bodies = []

    const fetchStub = async (url, opts) => {
      fetchCount++
      bodies.push(JSON.parse(opts.body))
      if (fetchCount === 1) {
        return {
          ok: true,
          json: async () => createInvalidCompositionResponse()
        }
      }
      return {
        ok: true,
        json: async () => createValidCompositionResponse()
      }
    }

    const result = await composeBot('echo messages', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(fetchCount, 2)
    assert.equal(result.kind, 'composed')
    assert.equal(Object.isFrozen(result.composition), true)

    // Assert retry prompt carries error but not raw composition
    const secondReqMessages = bodies[1].messages
    const secondUserMsg = secondReqMessages[secondReqMessages.length - 1].content
    assert.equal(secondUserMsg.includes('handlers.message.config.text is required'), true)
    assert.equal(secondUserMsg.includes('"msg-1"'), false)
  })

  it('refuses with validation_failed when two attempts fail validation', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    let fetchCount = 0

    const fetchStub = async () => {
      fetchCount++
      return {
        ok: true,
        json: async () => createInvalidCompositionResponse()
      }
    }

    const result = await composeBot('echo messages', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(fetchCount, 2)
    assert.equal(result.kind, 'refusal')
    assert.equal(result.reason, 'validation_failed')
    assert.equal(Array.isArray(result.errors), true)
    assert.equal(result.errors.length > 0, true)
  })

  it('refuses with composer_unavailable on first-attempt wire failure', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    let fetchCount = 0

    const fetchStub = async () => {
      fetchCount++
      throw new Error('Network error')
    }

    const result = await composeBot('echo messages', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(fetchCount, 1)
    assert.equal(result.kind, 'refusal')
    assert.equal(result.reason, 'composer_unavailable')
    assert.equal(result.errors, undefined)
  })

  it('refuses with composer_unavailable on second-attempt wire failure without errors field', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    let fetchCount = 0

    const fetchStub = async () => {
      fetchCount++
      if (fetchCount === 1) {
        return {
          ok: true,
          json: async () => createInvalidCompositionResponse()
        }
      }
      throw new Error('Network error on retry')
    }

    const result = await composeBot('echo messages', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(fetchCount, 2)
    assert.equal(result.kind, 'refusal')
    assert.equal(result.reason, 'composer_unavailable')
    assert.equal(result.errors, undefined)
  })

  it('retries on first-attempt invalid_json_content and can succeed on second attempt', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    let fetchCount = 0

    const fetchStub = async () => {
      fetchCount++
      if (fetchCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Not JSON text' } }]
          })
        }
      }
      return {
        ok: true,
        json: async () => createValidCompositionResponse()
      }
    }

    const result = await composeBot('echo messages', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(fetchCount, 2)
    assert.equal(result.kind, 'composed')
  })

  it('refuses with validation_failed when second attempt returns invalid_json_content', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    let fetchCount = 0

    const fetchStub = async () => {
      fetchCount++
      if (fetchCount === 1) {
        return {
          ok: true,
          json: async () => createInvalidCompositionResponse()
        }
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Still not JSON' } }]
        })
      }
    }

    const result = await composeBot('echo messages', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(fetchCount, 2)
    assert.equal(result.kind, 'refusal')
    assert.equal(result.reason, 'validation_failed')
    assert.equal(Array.isArray(result.errors), true)
  })

  it('does not mutate intent string', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()
    const originalIntent = '  build a bot  '

    const fetchStub = async () => ({
      ok: true,
      json: async () => createValidCompositionResponse()
    })

    await composeBot(originalIntent, {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: fetchStub
      }
    })

    assert.equal(originalIntent, '  build a bot  ')
  })

  it('produces deeply equal results for identical inputs and stubs', async () => {
    const registry = createStubRegistry()
    const library = createStubLibrary()

    const makeFetch = () => async () => ({
      ok: true,
      json: async () => createValidCompositionResponse()
    })

    const res1 = await composeBot('echo', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: makeFetch()
      }
    })

    const res2 = await composeBot('echo', {
      registry,
      library,
      llm: {
        upstreamUrl: 'http://localhost/v1/llm/complete',
        apiKey: 'test-key',
        model: 'test-model',
        fetch: makeFetch()
      }
    })

    assert.deepEqual(res1, res2)
  })
})
