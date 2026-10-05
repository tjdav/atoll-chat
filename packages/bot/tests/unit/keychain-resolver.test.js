import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { keychainResolver } from '../../src/runtime/keystore/resolvers/keychain.js'

/**
 * @param {(cmd: string, args: string[], opts?: { input?: string, timeoutMs?: number }) => Promise<string>} behavior - Synthetic behavior function.
 */
function makeRunner (behavior) {
  /** @type {Array<{ cmd: string, args: string[], opts?: { input?: string, timeoutMs?: number } }>} */
  const calls = []
  /** @type {import('../../src/runtime/keystore/resolvers/keychain.js').Runner} */
  const runner = async (cmd, args, opts) => {
    if (opts !== undefined) {
      calls.push({ cmd, args, opts })
    } else {
      calls.push({ cmd, args })
    }
    return behavior(cmd, args, opts)
  }
  return { runner, calls }
}

describe('Keychain resolver unit tests', () => {
  const ctx = { botId: 'b_test123', path: '/dummy/path', interactive: false }

  test('1. macOS — password returned', async () => {
    const { runner } = makeRunner(async () => 'secret\n')
    const resolver = keychainResolver({ platform: 'darwin', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, 'secret')
  })

  test('2. macOS — item not found', async () => {
    const { runner } = makeRunner(async () => {
      throw Object.assign(new Error('not found'), { code: 44 })
    })
    const resolver = keychainResolver({ platform: 'darwin', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, null)
  })

  test('3. macOS — command missing', async () => {
    const { runner } = makeRunner(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const resolver = keychainResolver({ platform: 'darwin', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, null)
  })

  test('4. macOS — command construction', async () => {
    const { runner, calls } = makeRunner(async () => 'secret\n')
    const resolver = keychainResolver({ platform: 'darwin', runner })
    await resolver.resolve(ctx)
    assert.equal(calls.length, 1)
    const call = calls[0]
    assert.ok(call)
    assert.ok(call.cmd.endsWith('/security'))
    assert.deepEqual(call.args, ['find-generic-password', '-s', 'atoll-bot', '-a', 'b_test123', '-w'])
  })

  test('5. Linux — password returned', async () => {
    const { runner } = makeRunner(async () => 'secret\n')
    const resolver = keychainResolver({ platform: 'linux', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, 'secret')
  })

  test('6. Linux — command missing', async () => {
    const { runner } = makeRunner(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const resolver = keychainResolver({ platform: 'linux', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, null)
  })

  test('7. Linux — command construction', async () => {
    const { runner, calls } = makeRunner(async () => 'secret\n')
    const resolver = keychainResolver({ platform: 'linux', runner })
    await resolver.resolve(ctx)
    assert.equal(calls.length, 1)
    const call = calls[0]
    assert.ok(call)
    assert.equal(call.cmd, 'secret-tool')
    assert.deepEqual(call.args, ['lookup', 'service', 'atoll-bot', 'account', 'b_test123'])
  })

  test('8. Windows — password returned', async () => {
    const { runner } = makeRunner(async () => 'secret\r\n')
    const resolver = keychainResolver({ platform: 'win32', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, 'secret')
  })

  test('9. Windows — target not found', async () => {
    const { runner } = makeRunner(async () => {
      throw Object.assign(new Error('not found'), { code: 2 })
    })
    const resolver = keychainResolver({ platform: 'win32', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, null)
  })

  test('10. Windows — script construction', async () => {
    const { runner, calls } = makeRunner(async () => 'secret\r\n')
    const resolver = keychainResolver({ platform: 'win32', runner })
    await resolver.resolve(ctx)
    assert.equal(calls.length, 1)
    const call = calls[0]
    assert.ok(call)
    assert.equal(call.cmd, 'powershell.exe')
    assert.deepEqual(call.args, ['-NoProfile', '-NonInteractive', '-Command', '-'])
    assert.ok(call.opts?.input?.includes('atoll-bot:b_test123'))
    assert.ok(call.opts?.input?.includes('CredRead'))
  })

  test('11. Unsupported platform', async () => {
    const { runner, calls } = makeRunner(async () => 'secret\n')
    const resolver = keychainResolver({ platform: 'freebsd', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, null)
    assert.equal(calls.length, 0)
  })

  test('12. Resolver id', () => {
    assert.equal(keychainResolver({ platform: 'darwin' }).id, 'keychain:darwin')
    assert.equal(keychainResolver({ platform: 'linux' }).id, 'keychain:linux')
    assert.equal(keychainResolver({ platform: 'win32' }).id, 'keychain:win32')
    assert.equal(keychainResolver({ platform: 'freebsd' }).id, 'keychain:unsupported')
  })

  test('13. No throw on unexpected runner rejection', async () => {
    const { runner } = makeRunner(async () => {
      throw new Error('something unexpected')
    })
    const resolver = keychainResolver({ platform: 'darwin', runner })
    const result = await resolver.resolve(ctx)
    assert.equal(result, null)
  })
})
