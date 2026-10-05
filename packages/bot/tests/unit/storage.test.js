import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import { Storage, RUNTIME_PREFIX } from '../../src/runtime/storage/index.js'
import { encrypt } from '../../src/runtime/storage/crypto.js'

describe('Storage unit tests', () => {
  /** @type {string} */
  let tmpDir

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'))
  })

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  const makeSeed = () => crypto.randomBytes(32)

  it('1. Open with missing file', async () => {
    const filePath = path.join(tmpDir, 'test1.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test1' })

    await storage.open()
    const val = await storage.get('anything')
    assert.equal(val, undefined)
  })

  it('2. Round-trip', async () => {
    const filePath = path.join(tmpDir, 'test2.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test2' })

    await storage.open()
    await storage.set('a', 1)
    await storage.set('b', 'two')

    assert.equal(await storage.get('a'), 1)
    assert.equal(await storage.get('b'), 'two')
  })

  it('3. Persistence', async () => {
    const filePath = path.join(tmpDir, 'test3.json')
    const seed = makeSeed()
    const botId = 'b_test3'

    const storage1 = new Storage({ path: filePath, seed, botId })
    await storage1.open()
    await storage1.set('x', 42)
    await storage1.close()

    const storage2 = new Storage({ path: filePath, seed, botId })
    await storage2.open()
    assert.equal(await storage2.get('x'), 42)
  })

  it('4. Delete', async () => {
    const filePath = path.join(tmpDir, 'test4.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test4' })

    await storage.open()
    await storage.set('a', 1)
    await storage.delete('a')
    assert.equal(await storage.get('a'), undefined)
  })

  it('5. Delete missing key', async () => {
    const filePath = path.join(tmpDir, 'test5.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test5' })

    await storage.open()
    await storage.delete('nope')
    assert.equal(await storage.get('nope'), undefined)
  })

  it('6. Clear preserves runtime keys', async () => {
    const filePath = path.join(tmpDir, 'test6.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test6' })

    await storage.open()
    await storage.set('author1', 1)
    await storage.set(`${RUNTIME_PREFIX}foo`, 2)
    await storage.clear()

    assert.equal(await storage.get('author1'), undefined)
    assert.equal(await storage.get(`${RUNTIME_PREFIX}foo`), 2)
  })

  it('7. Clear with no author keys', async () => {
    const filePath = path.join(tmpDir, 'test7.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test7' })

    await storage.open()
    await storage.set(`${RUNTIME_PREFIX}a`, 1)
    await storage.clear()

    assert.equal(await storage.get(`${RUNTIME_PREFIX}a`), 1)
  })

  it('8. Bot ID mismatch', async () => {
    const filePath = path.join(tmpDir, 'test8.json')
    const seed = makeSeed()

    const storage1 = new Storage({ path: filePath, seed, botId: 'b_wrong' })
    await storage1.open()
    await storage1.set('k', 'v')
    await storage1.close()

    const storage2 = new Storage({ path: filePath, seed, botId: 'b_correct' })
    await assert.rejects(
      async () => {
        await storage2.open()
      },
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('bot_id'))
        return true
      }
    )
  })

  it('9. Wrong seed', async () => {
    const filePath = path.join(tmpDir, 'test9.json')
    const seed1 = makeSeed()
    const seed2 = makeSeed()
    const botId = 'b_test9'

    const storage1 = new Storage({ path: filePath, seed: seed1, botId })
    await storage1.open()
    await storage1.set('k', 'v')
    await storage1.close()

    const storage2 = new Storage({ path: filePath, seed: seed2, botId })
    await assert.rejects(
      async () => {
        await storage2.open()
      },
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('decrypt') || err.message.includes('seed'))
        return true
      }
    )
  })

  it('10. Corrupt JSON', async () => {
    const filePath = path.join(tmpDir, 'test10.json')
    await fs.writeFile(filePath, 'not json', 'utf8')

    const storage = new Storage({ path: filePath, seed: makeSeed(), botId: 'b_test10' })
    await assert.rejects(
      async () => {
        await storage.open()
      },
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('JSON'))
        return true
      }
    )
  })

  it('11. Bad version', async () => {
    const filePath = path.join(tmpDir, 'test11.json')
    const outer = {
      version: 2,
      bot_id: 'b_test11',
      nonce: Buffer.alloc(12).toString('base64url'),
      ct: Buffer.alloc(16).toString('base64url')
    }
    await fs.writeFile(filePath, JSON.stringify(outer), 'utf8')

    const storage = new Storage({ path: filePath, seed: makeSeed(), botId: 'b_test11' })
    await assert.rejects(
      async () => {
        await storage.open()
      },
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('version'))
        return true
      }
    )
  })

  it('12. Ciphertext on disk', async () => {
    const filePath = path.join(tmpDir, 'test12.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test12' })

    await storage.open()
    await storage.set('secret', 'plaintext-value')

    const diskContent = await fs.readFile(filePath, 'utf8')
    assert.equal(diskContent.includes('plaintext-value'), false)
    assert.equal(diskContent.includes('secret'), false)
  })

  it('13. Non-serializable value', async () => {
    const filePath = path.join(tmpDir, 'test13.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test13' })

    await storage.open()
    await assert.rejects(
      async () => {
        await storage.set('bad', BigInt(1))
      },
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('JSON-serializable') || err.message.includes('BigInt'))
        return true
      }
    )
  })

  it('14. Concurrent writes serialize', async () => {
    const filePath = path.join(tmpDir, 'test14.json')
    const seed = makeSeed()
    const botId = 'b_test14'
    const storage1 = new Storage({ path: filePath, seed, botId })

    await storage1.open()
    await Promise.all([
      storage1.set('a', 1),
      storage1.set('b', 2),
      storage1.set('c', 3)
    ])

    const storage2 = new Storage({ path: filePath, seed, botId })
    await storage2.open()
    assert.equal(await storage2.get('a'), 1)
    assert.equal(await storage2.get('b'), 2)
    assert.equal(await storage2.get('c'), 3)
  })

  it('15. JSON value types', async () => {
    const filePath = path.join(tmpDir, 'test15.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test15' })

    await storage.open()
    await storage.set('num', 123)
    await storage.set('str', 'hello')
    await storage.set('bool', true)
    await storage.set('nullVal', null)
    await storage.set('arr', [1, 'two', false])
    await storage.set('obj', { nested: 'value' })

    assert.equal(await storage.get('num'), 123)
    assert.equal(await storage.get('str'), 'hello')
    assert.equal(await storage.get('bool'), true)
    assert.equal(await storage.get('nullVal'), null)
    assert.deepEqual(await storage.get('arr'), [1, 'two', false])
    assert.deepEqual(await storage.get('obj'), { nested: 'value' })
  })

  it('16. keys() returns the current key list', async () => {
    const filePath = path.join(tmpDir, 'test16.json')
    const seed = makeSeed()
    const storage = new Storage({ path: filePath, seed, botId: 'b_test16' })

    await storage.open()
    await storage.set('k1', 1)
    await storage.set('k2', 2)
    await storage.set('k3', 3)

    const keyList = storage.keys()
    assert.equal(keyList.length, 3)
    assert.ok(keyList.includes('k1'))
    assert.ok(keyList.includes('k2'))
    assert.ok(keyList.includes('k3'))
  })

  it('17. close() waits for pending writes', async () => {
    const filePath = path.join(tmpDir, 'test17.json')
    const seed = makeSeed()
    const botId = 'b_test17'
    const storage1 = new Storage({ path: filePath, seed, botId })

    await storage1.open()
    const setPromise = storage1.set('a', 1)
    await storage1.close()
    await setPromise

    const storage2 = new Storage({ path: filePath, seed, botId })
    await storage2.open()
    assert.equal(await storage2.get('a'), 1)
  })

  it('18. Additional coverage: malformed ct/nonce/outer/plaintext', async () => {
    const filePath = path.join(tmpDir, 'test18.json')
    const seed = makeSeed()
    const botId = 'b_test18'

    // Array outer
    await fs.writeFile(filePath, '[]', 'utf8')
    const s1 = new Storage({ path: filePath, seed, botId })
    await assert.rejects(() => s1.open(), /outer content must be a JSON object/)

    // Malformed nonce
    const outerBadNonce = {
      version: 1,
      bot_id: botId,
      nonce: 'invalid!',
      ct: Buffer.alloc(16).toString('base64url')
    }
    await fs.writeFile(filePath, JSON.stringify(outerBadNonce), 'utf8')
    const s2 = new Storage({ path: filePath, seed, botId })
    await assert.rejects(() => s2.open(), /nonce must be a 12-byte base64url string/)

    // Malformed ct
    const outerBadCt = {
      version: 1,
      bot_id: botId,
      nonce: Buffer.alloc(12).toString('base64url'),
      ct: 'short'
    }
    await fs.writeFile(filePath, JSON.stringify(outerBadCt), 'utf8')
    const s3 = new Storage({ path: filePath, seed, botId })
    await assert.rejects(() => s3.open(), /ct must be a base64url string/)

    // Non-JSON plaintext
    const derivedBuf = crypto.hkdfSync('sha256', seed, Buffer.alloc(0), Buffer.from('bot-storage-v1', 'utf8'), 32)
    const key = new Uint8Array(derivedBuf)
    const nonce = crypto.randomBytes(12)
    const ctWithTag = encrypt(key, nonce, Buffer.from('not json', 'utf8'))
    const outerNonJsonPt = {
      version: 1,
      bot_id: botId,
      nonce: Buffer.from(nonce).toString('base64url'),
      ct: Buffer.from(ctWithTag).toString('base64url')
    }
    await fs.writeFile(filePath, JSON.stringify(outerNonJsonPt), 'utf8')
    const s4 = new Storage({ path: filePath, seed, botId })
    await assert.rejects(() => s4.open(), /storage plaintext is not valid JSON/)

    // Non-object plaintext
    const ctWithTagArr = encrypt(key, nonce, Buffer.from('[1,2,3]', 'utf8'))
    const outerArrPt = {
      version: 1,
      bot_id: botId,
      nonce: Buffer.from(nonce).toString('base64url'),
      ct: Buffer.from(ctWithTagArr).toString('base64url')
    }
    await fs.writeFile(filePath, JSON.stringify(outerArrPt), 'utf8')
    const s5 = new Storage({ path: filePath, seed, botId })
    await assert.rejects(() => s5.open(), /storage plaintext must be a JSON object/)
  })
})
