import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import { Storage, RUNTIME_PREFIX } from '../../src/runtime/storage/index.js'
import { createStorageStore } from '../../src/runtime/context/storage.js'
import { StorageReservedPrefixError } from '../../src/errors.js'

describe('StorageStore unit tests', () => {
  /** @type {string} */
  let tmpDir
  /** @type {Storage} */
  let storage
  /** @type {StorageStore} */
  let store

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctx-storage-test-'))
    const filePath = path.join(tmpDir, 'storage.json')
    const seed = crypto.randomBytes(32)
    storage = new Storage({ path: filePath, seed, botId: 'b_test_store' })
    await storage.open()
    store = createStorageStore({ storage })
  })

  afterEach(async () => {
    if (storage) {
      await storage.close()
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('1. Get delegates', async () => {
    await storage.set('my_key', 'my_value')
    const result = await store.get('my_key')
    assert.equal(result, 'my_value')
  })

  it('2. Set delegates', async () => {
    await store.set('author_key', { count: 123 })
    const directValue = await storage.get('author_key')
    assert.deepEqual(directValue, { count: 123 })
  })

  it('3. Delete delegates', async () => {
    await storage.set('temp_key', 'delete_me')
    await store.delete('temp_key')
    const directValue = await storage.get('temp_key')
    assert.equal(directValue, undefined)
  })

  it('4. Clear delegates and preserves runtime keys', async () => {
    await storage.set('author_1', 'val1')
    await storage.set('author_2', 'val2')
    await storage.set(`${RUNTIME_PREFIX}internal_state`, 'preserve_me')

    await store.clear()

    assert.equal(await storage.get('author_1'), undefined)
    assert.equal(await storage.get('author_2'), undefined)
    assert.equal(await storage.get(`${RUNTIME_PREFIX}internal_state`), 'preserve_me')
  })

  it('5. Reserved prefix rejected on get', async () => {
    await assert.rejects(
      async () => {
        await store.get('_runtime:some_key')
      },
      (err) => {
        assert.ok(err instanceof StorageReservedPrefixError)
        assert.equal(err.code, 'storage_reserved_prefix')
        return true
      }
    )
  })

  it('6. Reserved prefix rejected on set', async () => {
    await assert.rejects(
      async () => {
        await store.set('_runtime:some_key', 'val')
      },
      (err) => {
        assert.ok(err instanceof StorageReservedPrefixError)
        assert.equal(err.code, 'storage_reserved_prefix')
        return true
      }
    )
  })

  it('7. Reserved prefix rejected on delete', async () => {
    await assert.rejects(
      async () => {
        await store.delete('_runtime:some_key')
      },
      (err) => {
        assert.ok(err instanceof StorageReservedPrefixError)
        assert.equal(err.code, 'storage_reserved_prefix')
        return true
      }
    )
  })

  it('8. Non-string key rejected on get', async () => {
    await assert.rejects(
      async () => {
        // @ts-expect-error testing invalid input
        await store.get(42)
      },
      TypeError
    )
  })

  it('9. Non-string key rejected on set and delete', async () => {
    await assert.rejects(
      async () => {
        // @ts-expect-error testing invalid input
        await store.set(123, 'value')
      },
      TypeError
    )
    await assert.rejects(
      async () => {
        // @ts-expect-error testing invalid input
        await store.delete({ key: 'foo' })
      },
      TypeError
    )
  })

  it('10. Empty key rejected', async () => {
    await assert.rejects(
      async () => {
        await store.get('')
      },
      TypeError
    )
    await assert.rejects(
      async () => {
        await store.set('', 'val')
      },
      TypeError
    )
    await assert.rejects(
      async () => {
        await store.delete('')
      },
      TypeError
    )
  })

  it('11. null key rejected', async () => {
    await assert.rejects(
      async () => {
        // @ts-expect-error testing invalid input
        await store.get(null)
      },
      TypeError
    )
  })

  it('12. undefined key rejected', async () => {
    await assert.rejects(
      async () => {
        // @ts-expect-error testing invalid input
        await store.get(undefined)
      },
      TypeError
    )
  })

  it('13. Clear does not take a key', async () => {
    await storage.set('user_data', 'foo')
    await storage.set(`${RUNTIME_PREFIX}data`, 'bar')

    // @ts-expect-error testing passing unused argument
    await store.clear('_runtime:ignored_arg')

    assert.equal(await storage.get('user_data'), undefined)
    assert.equal(await storage.get(`${RUNTIME_PREFIX}data`), 'bar')
  })
})
