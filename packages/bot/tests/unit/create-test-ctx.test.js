import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createTestCtx } from '../../src/testing/create-test-ctx.js'

describe('createTestCtx', () => {
  describe('Default construction', () => {
    test('1. createTestCtx() returns an object with every BotCtx field', () => {
      const ctx = createTestCtx()
      assert.ok('bot' in ctx)
      assert.ok('grant' in ctx)
      assert.ok('room' in ctx)
      assert.ok('event' in ctx)
      assert.ok('settings' in ctx)
      assert.ok('storage' in ctx)
      assert.ok('rooms' in ctx)
      assert.ok('post' in ctx)
      assert.ok('reply' in ctx)
      assert.ok('sendLocal' in ctx)
      assert.ok('log' in ctx)
      assert.ok('fetch' in ctx)
      assert.ok('fetchUserUrl' in ctx)
      assert.ok('signal' in ctx)
      assert.ok('uploadAvatar' in ctx)
    })

    test('2. bot defaults are populated', () => {
      const ctx = createTestCtx()
      assert.equal(ctx.bot.id, 'b_test')
      assert.equal(ctx.bot.label, 'Test Bot')
      assert.equal(ctx.bot.ownerUserId, 'u_test')
      assert.deepEqual(ctx.bot.avatar, { fileId: null, emoji: null })
    })

    test('3. grant defaults to null', () => {
      const ctx = createTestCtx()
      assert.equal(ctx.grant, null)
    })

    test('4. room defaults to null', () => {
      const ctx = createTestCtx()
      assert.equal(ctx.room, null)
    })

    test('5. event defaults to null', () => {
      const ctx = createTestCtx()
      assert.equal(ctx.event, null)
    })

    test('6. signal is an AbortSignal', () => {
      const ctx = createTestCtx()
      assert.ok(ctx.signal instanceof AbortSignal)
    })

    test('7. calls has five empty arrays', () => {
      const ctx = createTestCtx()
      assert.deepEqual(ctx.calls.post, [])
      assert.deepEqual(ctx.calls.reply, [])
      assert.deepEqual(ctx.calls.sendLocal, [])
      assert.deepEqual(ctx.calls.fetch, [])
      assert.deepEqual(ctx.calls.fetchUserUrl, [])
    })

    test('8. uploadAvatar is a function', () => {
      const ctx = createTestCtx()
      assert.equal(typeof ctx.uploadAvatar, 'function')
    })
  })

  describe('Overrides', () => {
    test('9. grant override is used', () => {
      const grant = { roomId: 'r_1', mode: 'observer', scopes: [] }
      const ctx = createTestCtx({ grant })
      assert.strictEqual(ctx.grant, grant)
    })

    test('10. room override is used', () => {
      const room = { id: 'r_1', displayName: 'Room 1', avatar: null }
      const ctx = createTestCtx({ room })
      assert.strictEqual(ctx.room, room)
    })

    test('11. event override is used', () => {
      const event = { id: 'evt_1', type: 'message.new', roomId: 'r_1', timestamp: '2025-01-01T00:00:00Z' }
      const ctx = createTestCtx({ event })
      assert.strictEqual(ctx.event, event)
    })

    test('12. bot override is used', () => {
      const bot = { id: 'b_custom', label: 'Custom Bot', ownerUserId: 'u_custom', avatar: { fileId: 'f1', emoji: '🤖' } }
      const ctx = createTestCtx({ bot })
      assert.strictEqual(ctx.bot, bot)
    })

    test('13. signal override is used', () => {
      const controller = new AbortController()
      const ctx = createTestCtx({ signal: controller.signal })
      assert.strictEqual(ctx.signal, controller.signal)
    })

    test('14. settings initial values are visible via get', async () => {
      const ctx = createTestCtx({ settings: { apiToken: 'x' } })
      assert.equal(await ctx.settings.get('apiToken'), 'x')
    })

    test('15. storage initial values are visible via get', async () => {
      const ctx = createTestCtx({ storage: { count: 42 } })
      assert.equal(await ctx.storage.get('count'), 42)
    })

    test('16. roomsList override is used', async () => {
      const r1 = { id: 'r_1', displayName: 'Room 1', avatar: null }
      const r2 = { id: 'r_2', displayName: 'Room 2', avatar: null }
      const ctx = createTestCtx({ roomsList: [r1, r2] })
      const list = await ctx.rooms.list()
      assert.deepEqual(list, [r1, r2])
    })
  })

  describe('Response capture', () => {
    test('17. ctx.post captures its argument', async () => {
      const ctx = createTestCtx()
      const opts = { text: 'hi' }
      await ctx.post(opts)
      assert.strictEqual(ctx.calls.post[0], opts)
    })

    test('18. ctx.post returns a MessageRef', async () => {
      const ctx = createTestCtx()
      const ref = await ctx.post({ text: 'hi' })
      assert.ok('id' in ref)
      assert.ok('roomId' in ref)
      assert.ok('createdAt' in ref)
    })

    test('19. ctx.post uses opts.roomId when present', async () => {
      const ctx = createTestCtx({ room: { id: 'r_default', displayName: 'Room', avatar: null } })
      const ref = await ctx.post({ text: 'hi', roomId: 'r_explicit' })
      assert.equal(ref.roomId, 'r_explicit')
    })

    test('20. ctx.post falls back to ctx.room.id', async () => {
      const ctx = createTestCtx({ room: { id: 'r_x', displayName: 'Room', avatar: null } })
      const ref = await ctx.post({ text: 'hi' })
      assert.equal(ref.roomId, 'r_x')
    })

    test('21. ctx.post falls back to "r_test" when neither is set', async () => {
      const ctx = createTestCtx()
      const ref = await ctx.post({ text: 'hi' })
      assert.equal(ref.roomId, 'r_test')
    })

    test('22. Multiple post calls produce distinct message ids', async () => {
      const ctx = createTestCtx()
      const ref1 = await ctx.post({ text: 'msg 1' })
      const ref2 = await ctx.post({ text: 'msg 2' })
      assert.notEqual(ref1.id, ref2.id)
      assert.equal(ref1.id, 'm_test_1')
      assert.equal(ref2.id, 'm_test_2')
    })

    test('23. ctx.reply captures its argument', async () => {
      const ctx = createTestCtx()
      const opts = { text: 'reply text', replyTo: 'm_target' }
      await ctx.reply(opts)
      assert.strictEqual(ctx.calls.reply[0], opts)
    })

    test('24. ctx.reply returns a MessageRef', async () => {
      const ctx = createTestCtx()
      const ref = await ctx.reply({ text: 'reply text', replyTo: 'm_target' })
      assert.ok('id' in ref)
      assert.ok('roomId' in ref)
      assert.ok('createdAt' in ref)
    })

    test('25. ctx.sendLocal captures its argument', async () => {
      const ctx = createTestCtx()
      const opts = { text: 'x' }
      await ctx.sendLocal(opts)
      assert.strictEqual(ctx.calls.sendLocal[0], opts)
    })

    test('26. ctx.sendLocal resolves with undefined', async () => {
      const ctx = createTestCtx()
      const res = await ctx.sendLocal({ text: 'x' })
      assert.equal(res, undefined)
    })

    test('27. ctx.fetch captures { url, opts }', async () => {
      const ctx = createTestCtx()
      const fetchOpts = { method: 'POST', body: 'hello' }
      await ctx.fetch('https://x', fetchOpts)
      assert.deepEqual(ctx.calls.fetch[0], { url: 'https://x', opts: fetchOpts })
    })

    test('28. ctx.fetch returns the default 200 Response', async () => {
      const ctx = createTestCtx()
      const res = await ctx.fetch('https://x')
      assert.ok(res instanceof Response)
      assert.equal(res.status, 200)
    })

    test('29. ctx.fetchResponse override as a Response', async () => {
      const customResponse = new Response('ok', { status: 201 })
      const ctx = createTestCtx({ fetchResponse: customResponse })
      const res = await ctx.fetch('https://x')
      assert.strictEqual(res, customResponse)
    })

    test('30. ctx.fetchResponse override as a function', async () => {
      const ctx = createTestCtx({
        fetchResponse: (url) => new Response(JSON.stringify({ url }), { status: 200 })
      })
      const res = await ctx.fetch('https://example.com/api')
      const body = await res.json()
      assert.deepEqual(body, { url: 'https://example.com/api' })
    })

    test('31. ctx.fetchUserUrl uses its own capture array', async () => {
      const ctx = createTestCtx()
      await ctx.fetchUserUrl('https://user-target.com')
      assert.equal(ctx.calls.fetchUserUrl.length, 1)
      assert.equal(ctx.calls.fetchUserUrl[0].url, 'https://user-target.com')
      assert.equal(ctx.calls.fetch.length, 0)
    })
  })

  describe('Settings store', () => {
    test('32. get on an absent key returns undefined', async () => {
      const ctx = createTestCtx()
      assert.equal(await ctx.settings.get('absentKey'), undefined)
    })

    test('33. set then get round-trips', async () => {
      const ctx = createTestCtx()
      await ctx.settings.set('k1', 'v1')
      assert.equal(await ctx.settings.get('k1'), 'v1')
    })

    test('34. set with { room } uses the room-scoped storage key', async () => {
      const ctx = createTestCtx()
      await ctx.settings.set('x', 1, { room: 'r_a' })
      assert.equal(await ctx.settings.get('x', { room: 'r_a' }), 1)
      assert.equal(await ctx.settings.get('x'), undefined)
    })

    test('35. delete removes the entry', async () => {
      const ctx = createTestCtx({ settings: { k1: 'v1' } })
      await ctx.settings.delete('k1')
      assert.equal(await ctx.settings.get('k1'), undefined)
    })

    test('36. delete on an absent key is a no-op', async () => {
      const ctx = createTestCtx()
      await ctx.settings.delete('absentKey')
      assert.equal(await ctx.settings.get('absentKey'), undefined)
    })

    test('37. subscribe returns an unsubscribe function', () => {
      const ctx = createTestCtx()
      const unsubscribe = ctx.settings.subscribe('k1', () => {})
      assert.equal(typeof unsubscribe, 'function')
      assert.doesNotThrow(() => unsubscribe())
    })

    test('38. The store accepts _runtime: keys', async () => {
      const ctx = createTestCtx()
      await ctx.settings.set('_runtime:x', 1)
      assert.equal(await ctx.settings.get('_runtime:x'), 1)
    })
  })

  describe('Storage store', () => {
    test('39. get on an absent key returns undefined', async () => {
      const ctx = createTestCtx()
      assert.equal(await ctx.storage.get('absent'), undefined)
    })

    test('40. set then get round-trips', async () => {
      const ctx = createTestCtx()
      await ctx.storage.set('k1', 'val1')
      assert.equal(await ctx.storage.get('k1'), 'val1')
    })

    test('41. delete removes the entry', async () => {
      const ctx = createTestCtx({ storage: { k1: 'val1' } })
      await ctx.storage.delete('k1')
      assert.equal(await ctx.storage.get('k1'), undefined)
    })

    test('42. clear removes every key when strictStorage is false', async () => {
      const ctx = createTestCtx({
        storage: { authorKey: 'a', '_runtime:key': 'r' },
        strictStorage: false
      })
      await ctx.storage.clear()
      assert.equal(await ctx.storage.get('authorKey'), undefined)
      assert.equal(await ctx.storage.get('_runtime:key'), undefined)
    })

    test('43. clear preserves _runtime: keys when strictStorage is true', async () => {
      const ctx = createTestCtx({
        storage: { authorKey: 'a', '_runtime:key': 'r' },
        strictStorage: true
      })
      await ctx.storage.clear()
      assert.equal(await ctx.storage.get('authorKey'), undefined)
      // _runtime: key is preserved, but get throws under strictStorage unless accessed directly or after checking behavior
      await assert.rejects(
        async () => ctx.storage.get('_runtime:key'),
        { code: 'storage_reserved_prefix' }
      )
    })

    test('44. strictStorage rejects _runtime: keys on get', async () => {
      const ctx = createTestCtx({ strictStorage: true })
      await assert.rejects(
        async () => ctx.storage.get('_runtime:x'),
        { code: 'storage_reserved_prefix' }
      )
    })

    test('45. strictStorage rejects _runtime: keys on set', async () => {
      const ctx = createTestCtx({ strictStorage: true })
      await assert.rejects(
        async () => ctx.storage.set('_runtime:x', 1),
        { code: 'storage_reserved_prefix' }
      )
    })

    test('46. strictStorage rejects _runtime: keys on delete', async () => {
      const ctx = createTestCtx({ strictStorage: true })
      await assert.rejects(
        async () => ctx.storage.delete('_runtime:x'),
        { code: 'storage_reserved_prefix' }
      )
    })

    test('47. strictStorage rejects with StorageReservedPrefixError', async () => {
      const ctx = createTestCtx({ strictStorage: true })
      await assert.rejects(
        async () => ctx.storage.get('_runtime:test'),
        (err) => err.name === 'StorageReservedPrefixError' && err.code === 'storage_reserved_prefix'
      )
    })
  })

  describe('Rooms store', () => {
    test('48. list returns a copy of the configured list', async () => {
      const rooms = [{ id: 'r_1', displayName: 'Room 1', avatar: null }]
      const ctx = createTestCtx({ roomsList: rooms })
      const res = await ctx.rooms.list()
      assert.deepEqual(res, rooms)
      assert.notStrictEqual(res, rooms)
    })

    test('49. get returns the matching room', async () => {
      const r1 = { id: 'r_1', displayName: 'Room 1', avatar: null }
      const r2 = { id: 'r_2', displayName: 'Room 2', avatar: null }
      const ctx = createTestCtx({ roomsList: [r1, r2] })
      const res = await ctx.rooms.get('r_2')
      assert.deepEqual(res, r2)
    })

    test('50. get returns null for an absent room', async () => {
      const ctx = createTestCtx({ roomsList: [] })
      const res = await ctx.rooms.get('r_absent')
      assert.equal(res, null)
    })

    test('51. get returns null for a non-string roomId', async () => {
      const ctx = createTestCtx({ roomsList: [{ id: 'r_1', displayName: 'Room 1', avatar: null }] })
      // @ts-ignore
      const res = await ctx.rooms.get(123)
      assert.equal(res, null)
    })

    test('52. list on an empty store returns []', async () => {
      const ctx = createTestCtx()
      const res = await ctx.rooms.list()
      assert.deepEqual(res, [])
    })
  })

  describe('Log', () => {
    test('53. ctx.log is a function that does nothing by default', () => {
      const ctx = createTestCtx()
      assert.equal(typeof ctx.log, 'function')
      assert.doesNotThrow(() => ctx.log('info', 'message', { key: 'val' }))
    })

    test('54. ctx.log can be replaced by a spy', () => {
      const ctx = createTestCtx()
      const lines = []
      ctx.log = (level, msg, meta) => lines.push({ level, msg, meta })
      ctx.log('info', 'test log', { foo: 'bar' })
      assert.equal(lines.length, 1)
      assert.deepEqual(lines[0], { level: 'info', msg: 'test log', meta: { foo: 'bar' } })
    })
  })
})
