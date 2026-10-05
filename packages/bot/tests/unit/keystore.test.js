import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Keystore, createKeystore } from '../../src/runtime/keystore/index.js'
import { envResolver } from '../../src/runtime/keystore/resolvers/env.js'
import { resolveChain } from '../../src/runtime/keystore/resolvers/index.js'
import { KeystoreLockedError, KeystoreCorruptError } from '../../src/errors.js'

describe('Keystore unit tests', () => {
  /** @type {string} */
  let tempDir

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'keystore-test-'))
  })

  const dummySecret = 'super-secret-passphrase'
  const dummyPlaintext = {
    version: 1,
    bot_id: 'b_test123',
    bot_token: 'test-token-43-chars-base64url-sample-string-1234',
    bot_identity_private: Buffer.alloc(32, 1).toString('base64url'),
    bot_command_private: Buffer.alloc(32, 2).toString('base64url'),
    identity_private: Buffer.alloc(32, 3).toString('base64url'),
    storage_seed: Buffer.alloc(32, 4).toString('base64url'),
    operator_session: 'op_session_abc',
    created_at: new Date().toISOString(),
    rotated_at: new Date().toISOString()
  }

  /**
   * @param {string} secret
   * @returns {import('../../src/runtime/keystore/resolvers/index.js').Resolver}
   */
  const dummyResolver = (secret) => ({
    id: 'dummy',
    async resolve () {
      return secret
    }
  })

  test('1. Round-trip', async () => {
    const ksPath = join(tempDir, 'keystore.json')
    await createKeystore({
      path: ksPath,
      secret: dummySecret,
      data: dummyPlaintext
    })

    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    const loaded = await keystore.load()
    assert.deepEqual(loaded, dummyPlaintext)
    assert.equal(keystore.botId, 'b_test123')
  })

  test('2. Wrong secret', async () => {
    const ksPath = join(tempDir, 'keystore.json')
    await createKeystore({
      path: ksPath,
      secret: 'secret-a',
      data: dummyPlaintext
    })

    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver('secret-b')]
    })

    await assert.rejects(
      async () => {
        await keystore.load()
      },
      (err) => {
        return err instanceof KeystoreLockedError && err.code === 'keystore_locked'
      }
    )
  })

  test('3. Missing file', async () => {
    const ksPath = join(tempDir, 'non-existent.json')
    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    await assert.rejects(
      async () => {
        await keystore.load()
      },
      (err) => {
        return err instanceof KeystoreLockedError && err.code === 'keystore_locked'
      }
    )
  })

  test('4. Invalid JSON', async () => {
    const ksPath = join(tempDir, 'bad-json.json')
    await writeFile(ksPath, 'not json content', 'utf8')

    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    await assert.rejects(
      async () => {
        await keystore.load()
      },
      (err) => {
        return err instanceof KeystoreCorruptError && err.code === 'keystore_corrupt'
      }
    )
  })

  test('5. Bad outer schema', async () => {
    const ksPath = join(tempDir, 'bad-outer.json')
    await writeFile(ksPath, JSON.stringify({ version: 2 }), 'utf8')

    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    await assert.rejects(
      async () => {
        await keystore.load()
      },
      (err) => {
        return (
          err instanceof KeystoreCorruptError &&
          err.code === 'keystore_corrupt' &&
          err.message.includes('version')
        )
      }
    )
  })

  test('6. Bad plaintext schema', async () => {
    const salt = Buffer.alloc(16, 0)
    const nonce = Buffer.alloc(12, 0)
    const validCryptoKsPath = join(tempDir, 'invalid-plaintext-inner.json')
    const { deriveKey, encrypt } = await import('../../src/runtime/keystore/crypto.js')
    const key = await deriveKey(dummySecret, salt)
    const badPlaintext = { ...dummyPlaintext, bot_token: '' }
    const badPlaintextJson = JSON.stringify(badPlaintext)
    const encCt = encrypt(key, nonce, Buffer.from(badPlaintextJson, 'utf8'))
    const badOuter = {
      version: 1,
      bot_id: 'b_test123',
      salt: salt.toString('base64url'),
      nonce: nonce.toString('base64url'),
      ct: Buffer.from(encCt).toString('base64url')
    }
    await writeFile(validCryptoKsPath, JSON.stringify(badOuter), 'utf8')

    const keystore = new Keystore({
      path: validCryptoKsPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    await assert.rejects(
      async () => {
        await keystore.load()
      },
      (err) => {
        return (
          err instanceof KeystoreCorruptError &&
          err.code === 'keystore_corrupt' &&
          err.message.includes('bot_token')
        )
      }
    )
  })

  test('7. Bot ID mismatch', async () => {
    const ksPath = join(tempDir, 'mismatch.json')
    await createKeystore({
      path: ksPath,
      secret: dummySecret,
      data: dummyPlaintext
    })

    const content = JSON.parse(await readFile(ksPath, 'utf8'))
    content.bot_id = 'b_different_id'
    await writeFile(ksPath, JSON.stringify(content), 'utf8')

    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    await assert.rejects(
      async () => {
        await keystore.load()
      },
      (err) => {
        return (
          err instanceof KeystoreCorruptError &&
          err.code === 'keystore_corrupt' &&
          err.message.includes('bot_id')
        )
      }
    )
  })

  test('8. Env resolver — set', async () => {
    /** @type {Record<string, string>} */
    const customEnv = { TEST_KEYSTORE_SECRET: 'env-passphrase-123' }
    const resolver = envResolver('TEST_KEYSTORE_SECRET', customEnv)
    const result = await resolver.resolve({
      botId: 'b_test',
      path: '/tmp/test',
      interactive: false
    })
    assert.equal(result, 'env-passphrase-123')
  })

  test('9. Env resolver — unset', async () => {
    /** @type {Record<string, string>} */
    const customEnv = {}
    const resolver = envResolver('TEST_KEYSTORE_SECRET', customEnv)
    const result = await resolver.resolve({
      botId: 'b_test',
      path: '/tmp/test',
      interactive: false
    })
    assert.equal(result, null)
  })

  test('10. Resolver chain ordering', async () => {
    const r1 = { id: 'r1', async resolve () { return null } }
    const r2 = { id: 'r2', async resolve () { return 'x' } }
    const result = await resolveChain([r1, r2], {
      botId: 'b_test',
      path: '/tmp/test',
      interactive: false
    })
    assert.equal(result, 'x')
  })

  test('11. Resolver chain empty', async () => {
    const result = await resolveChain([], {
      botId: 'b_test',
      path: '/tmp/test',
      interactive: false
    })
    assert.equal(result, null)
  })

  test('12. Save after load', async () => {
    const ksPath = join(tempDir, 'save-test.json')
    await createKeystore({
      path: ksPath,
      secret: dummySecret,
      data: dummyPlaintext
    })

    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    const loaded = /** @type {Record<string, unknown>} */ (await keystore.load())
    const updatedPlaintext = { ...loaded, operator_session: 'new_session_xyz' }
    await keystore.save(updatedPlaintext)

    const reloadedKeystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })
    const reloaded = /** @type {Record<string, unknown>} */ (await reloadedKeystore.load())
    assert.equal(reloaded['operator_session'], 'new_session_xyz')
  })

  test('13. Save without load', async () => {
    const ksPath = join(tempDir, 'save-without-load.json')
    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    await assert.rejects(
      async () => {
        await keystore.save(dummyPlaintext)
      },
      (err) => {
        return err instanceof KeystoreLockedError && err.code === 'keystore_locked'
      }
    )
  })

  test('14. Rotation via save', async () => {
    const ksPath = join(tempDir, 'rotation.json')
    await createKeystore({
      path: ksPath,
      secret: dummySecret,
      data: dummyPlaintext
    })

    const initialOuter = JSON.parse(await readFile(ksPath, 'utf8'))

    const keystore = new Keystore({
      path: ksPath,
      resolvers: [dummyResolver(dummySecret)]
    })

    const loaded = await keystore.load()
    const updated = { ...loaded, rotated_at: new Date().toISOString() }
    await keystore.save(updated)

    const savedOuter = JSON.parse(await readFile(ksPath, 'utf8'))
    assert.notEqual(savedOuter.salt, initialOuter.salt)
    assert.notEqual(savedOuter.nonce, initialOuter.nonce)
  })
})
