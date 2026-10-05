import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { keychainWriter } from '../../src/runtime/keystore/resolvers/keychain-write.js'

/**
 * @typedef {{ cmd: string, args: string[], opts?: { input?: string, timeoutMs?: number } | undefined }} Call
 */

/**
 * @param {(cmd: string, args: string[], opts?: { input?: string, timeoutMs?: number }) => Promise<string>} behavior
 */
function makeRunner (behavior) {
  /** @type {Call[]} */
  const calls = []
  /**
   * @param {string} cmd
   * @param {string[]} args
   * @param {{ input?: string, timeoutMs?: number }} [opts]
   */
  const runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    return behavior(cmd, args, opts)
  }
  return { runner, calls }
}

describe('Keychain writer unit tests', () => {
  it('1. macOS command construction', async () => {
    const { runner, calls } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'darwin', runner })
    await writer('b_test123', 'secret')

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.cmd, '/usr/bin/security')
    assert.deepEqual(calls[0]?.args, ['add-generic-password', '-s', 'atoll-bot', '-a', 'b_test123', '-U', '-w'])
    assert.equal(calls[0]?.opts?.input, 'secret')
  })

  it('2. macOS success', async () => {
    const { runner } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'darwin', runner })
    await assert.doesNotReject(async () => {
      await writer('b_test123', 'secret')
    })
  })

  it('3. macOS failure propagates', async () => {
    const { runner } = makeRunner(async () => {
      throw new Error('security failed')
    })
    const writer = keychainWriter({ platform: 'darwin', runner })
    await assert.rejects(
      async () => {
        await writer('b_test123', 'secret')
      },
      { message: 'security failed' }
    )
  })

  it('4. Linux command construction', async () => {
    const { runner, calls } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'linux', runner })
    await writer('b_test123', 'secret')

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.cmd, 'secret-tool')
    assert.deepEqual(calls[0]?.args, ['store', '--label', 'Atoll bot b_test123', 'service', 'atoll-bot', 'account', 'b_test123'])
    assert.equal(calls[0]?.opts?.input, 'secret')
  })

  it('5. Linux success', async () => {
    const { runner } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'linux', runner })
    await assert.doesNotReject(async () => {
      await writer('b_test123', 'secret')
    })
  })

  it('6. Linux failure propagates', async () => {
    const { runner } = makeRunner(async () => {
      throw new Error('secret-tool failed')
    })
    const writer = keychainWriter({ platform: 'linux', runner })
    await assert.rejects(
      async () => {
        await writer('b_test123', 'secret')
      },
      { message: 'secret-tool failed' }
    )
  })

  it('7. Windows command construction', async () => {
    const { runner, calls } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'win32', runner })
    await writer('b_test123', 'secret')

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.cmd, 'powershell.exe')
    assert.equal(calls[0]?.args[0], '-NoProfile')
    assert.equal(calls[0]?.args[1], '-NonInteractive')
    assert.equal(calls[0]?.args[2], '-EncodedCommand')
    assert.equal(calls[0]?.opts?.input, 'secret')
  })

  it('8. Windows encoded command round-trips', async () => {
    const { runner, calls } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'win32', runner })
    await writer('b_test123', 'secret')

    const encodedArg = calls[0]?.args[3] ?? ''
    const scriptBuffer = Buffer.from(encodedArg, 'base64')
    const script = scriptBuffer.toString('utf16le')

    assert.match(script, /atoll-bot:b_test123/)
    assert.match(script, /CredWrite/)
    assert.match(script, /\[Console\]::In\.ReadToEnd\(\)/)
  })

  it('9. Windows success', async () => {
    const { runner } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'win32', runner })
    await assert.doesNotReject(async () => {
      await writer('b_test123', 'secret')
    })
  })

  it('10. Windows failure propagates', async () => {
    const { runner } = makeRunner(async () => {
      throw new Error('powershell failed')
    })
    const writer = keychainWriter({ platform: 'win32', runner })
    await assert.rejects(
      async () => {
        await writer('b_test123', 'secret')
      },
      { message: 'powershell failed' }
    )
  })

  it('11. Unsupported platform is a no-op', async () => {
    const { runner, calls } = makeRunner(async () => '')
    const writer = keychainWriter({ platform: 'freebsd', runner })
    await writer('b_test123', 'secret')

    assert.equal(calls.length, 0)
  })
})
