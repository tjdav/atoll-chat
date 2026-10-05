import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promptResolver } from '../../src/runtime/keystore/resolvers/prompt.js'

/**
 * @typedef {{ botId: string, secret: string }} WriterCall
 */

describe('Prompt resolver unit tests', () => {
  it('1. Non-interactive context defers', async () => {
    let readerCalled = false
    const reader = async () => {
      readerCalled = true
      return 'secret'
    }
    const resolver = promptResolver({ reader })
    const result = await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: false
    })

    assert.equal(result, null)
    assert.equal(readerCalled, false)
  })

  it('2. Interactive, reader returns a secret', async () => {
    const reader = async () => 'secret'
    const resolver = promptResolver({ reader })
    const result = await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: true
    })

    assert.equal(result, 'secret')
  })

  it('3. Writer called with the right arguments', async () => {
    const reader = async () => 'secret'
    /** @type {WriterCall[]} */
    const writerCalls = []
    /**
     * @param {string} botId
     * @param {string} secret
     */
    const writer = async (botId, secret) => {
      writerCalls.push({ botId, secret })
    }
    const resolver = promptResolver({ reader, writer })
    await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: true
    })

    assert.equal(writerCalls.length, 1)
    assert.deepEqual(writerCalls[0], { botId: 'b_test123', secret: 'secret' })
  })

  it('4. Writer failure is swallowed', async () => {
    const reader = async () => 'secret'
    const writer = async () => {
      throw new Error('keychain store failed')
    }
    const resolver = promptResolver({ reader, writer })
    const result = await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: true
    })

    assert.equal(result, 'secret')
  })

  it('5. Reader returns an empty string', async () => {
    const reader = async () => ''
    let writerCalled = false
    const writer = async () => {
      writerCalled = true
    }
    const resolver = promptResolver({ reader, writer })
    const result = await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: true
    })

    assert.equal(result, null)
    assert.equal(writerCalled, false)
  })

  it('6. Reader throws', async () => {
    const reader = async () => {
      throw new Error('aborted')
    }
    let writerCalled = false
    const writer = async () => {
      writerCalled = true
    }
    const resolver = promptResolver({ reader, writer })
    const result = await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: true
    })

    assert.equal(result, null)
    assert.equal(writerCalled, false)
  })

  it('7. Reader returns a non-string', async () => {
    /** @type {any} */
    const reader = async () => null
    const resolver = promptResolver({ reader })
    const result = await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: true
    })

    assert.equal(result, null)
  })

  it('8. Resolver id', () => {
    const resolver = promptResolver()
    assert.equal(resolver.id, 'prompt')
  })

  it('9. Prompt message content', async () => {
    let capturedPrompt = ''
    /**
     * @param {string} prompt
     */
    const reader = async (prompt) => {
      capturedPrompt = prompt
      return 'secret'
    }
    const resolver = promptResolver({ reader })
    await resolver.resolve({
      botId: 'b_test123',
      path: '/path/to/keystore.json',
      interactive: true
    })

    assert.ok(capturedPrompt.startsWith('Keystore passphrase for b_test123'))
    assert.ok(capturedPrompt.endsWith(': '))
  })
})
