import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { dispatch } from '../../src/cli/index.js'
import { Keystore } from '../../src/runtime/keystore/index.js'
import { envResolver } from '../../src/runtime/keystore/resolvers/env.js'
import { createMockServer } from '../../src/testing/mock-server.js'

function makeIO (cwd, env, overrides = {}) {
  let out = ''
  let err = ''
  return {
    stdout: { write: (s) => { out += s } },
    stderr: { write: (s) => { err += s } },
    cwd,
    env,
    get out () { return out },
    get err () { return err },
    ...overrides
  }
}

function makeValidBotFile (dir, filename = 'my-bot.js') {
  const filepath = join(dir, filename)
  const defineBotUrl = new URL('../../src/define-bot.js', import.meta.url).href
  const code = `
import { defineBot } from ${JSON.stringify(defineBotUrl)}
export default defineBot({
  id: 'test.bot',
  label: 'Test Bot',
  hostApi: '1.0',
  capabilities: ['post_message'],
  handlers: { install () {} }
})
`
  writeFileSync(filepath, code, 'utf8')
  return filepath
}

test('cli-register: 1. Missing path argument -> exit 1, "requires a path"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const io = makeIO(tmp, {})
    const code = await dispatch(['register'], io)
    assert.equal(code, 1)
    assert.match(io.err, /requires a path/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 2. Nonexistent file -> exit 1, "file not found"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const io = makeIO(tmp, {})
    const code = await dispatch(['register', './nonexistent.js'], io)
    assert.equal(code, 1)
    assert.match(io.err, /file not found/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 3. Missing ATOL_SERVER_URL -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const botPath = makeValidBotFile(tmp)
    const io = makeIO(tmp, {
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', botPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /requires ATOL_SERVER_URL/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 4. Missing ATOL_USER_TOKEN -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const botPath = makeValidBotFile(tmp)
    const io = makeIO(tmp, {
      ATOL_SERVER_URL: 'http://127.0.0.1:9999',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', botPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /requires ATOL_USER_TOKEN/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 5. Missing ATOL_BOT_KEYSTORE_SECRET -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const botPath = makeValidBotFile(tmp)
    const io = makeIO(tmp, {
      ATOL_SERVER_URL: 'http://127.0.0.1:9999',
      ATOL_USER_TOKEN: 'user-token'
    })
    const code = await dispatch(['register', botPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /requires ATOL_BOT_KEYSTORE_SECRET/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 6. Existing keystore without --force -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const botPath = makeValidBotFile(tmp)
    const ksPath = join(tmp, 'bot.keystore')
    writeFileSync(ksPath, 'dummy keystore', 'utf8')

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: 'http://127.0.0.1:9999',
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', botPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /already exists; pass --force/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 7. Existing keystore with --force proceeds past pre-flight check', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  const server = await createMockServer()
  try {
    const serverUrl = await server.getUrl()
    const botPath = makeValidBotFile(tmp)
    const ksPath = join(tmp, 'bot.keystore')
    writeFileSync(ksPath, 'dummy keystore', 'utf8')

    server.setHandler('POST', '/api/v1/bots', (req, res) => {
      res.send(200, { bot_id: 'test-bot-id', bot_token: 'bot-token-123' })
    })

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: serverUrl,
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', botPath, '--force'], io)
    assert.equal(code, 0)
  } finally {
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 8. A file that fails to import -> exit 1, "failed to load"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const badPath = join(tmp, 'bad.js')
    writeFileSync(badPath, 'syntax error {{{', 'utf8')

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: 'http://127.0.0.1:9999',
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', badPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /failed to load/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 9. A file whose default export is not a Bot -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const notBotPath = join(tmp, 'not-bot.js')
    writeFileSync(notBotPath, 'export default { foo: "bar" }', 'utf8')

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: 'http://127.0.0.1:9999',
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', notBotPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /default export is not a Bot/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 10. A file whose config fails validation -> exit 1, contains failure list', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  try {
    const invalidConfigPath = join(tmp, 'invalid-config.js')
    const code = `
export default {
  config: {
    id: 'invalid id with spaces!',
    capabilities: ['invalid_cap']
  }
}
`
    writeFileSync(invalidConfigPath, code, 'utf8')

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: 'http://127.0.0.1:9999',
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const codeRes = await dispatch(['register', invalidConfigPath], io)
    assert.equal(codeRes, 1)
    assert.match(io.err, /validation failed:/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 11-22. Happy path registration tests', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  const server = await createMockServer()
  try {
    const serverUrl = await server.getUrl()
    const botPath = makeValidBotFile(tmp)

    server.setHandler('POST', '/api/v1/bots', (req, res) => {
      res.send(200, { bot_id: 'registered-bot-42', bot_token: 'bot-secret-token' })
    })

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: serverUrl,
      ATOL_USER_TOKEN: 'operator-session-token-abc',
      ATOL_BOT_KEYSTORE_SECRET: 'my-keystore-passphrase'
    })

    const code = await dispatch(['register', botPath], io)

    // 22. Exit code is 0
    assert.equal(code, 0)

    // 11. A valid bot file creates a keystore file at target path
    const ksPath = join(tmp, 'bot.keystore')
    assert.equal(existsSync(ksPath), true)

    // 12, 13, 14. Assert POST /bots request shape, auth header, public key lengths
    const reqs = server.requests.filter(r => r.method === 'POST' && r.path === '/api/v1/bots')
    assert.equal(reqs.length, 1)
    const req = reqs[0]

    // 13. Authorization header carries operator session
    assert.equal(req.headers.authorization, 'Bearer operator-session-token-abc')

    // 12. Display name, capabilities, and pubkey fields present
    const body = req.json
    assert.equal(body.display_name, 'Test Bot')
    assert.deepEqual(body.declared_scopes, ['post_message'])
    assert.equal(typeof body.bot_identity_pubkey, 'string')
    assert.equal(typeof body.bot_command_pubkey, 'string')
    assert.equal(typeof body.identity_pubkey, 'string')

    // 14. Public keys decode to 32 bytes
    const botIdentPub = Buffer.from(body.bot_identity_pubkey, 'base64url')
    const botCmdPub = Buffer.from(body.bot_command_pubkey, 'base64url')
    const identPub = Buffer.from(body.identity_pubkey, 'base64url')
    assert.equal(botIdentPub.length, 32)
    assert.equal(botCmdPub.length, 32)
    assert.equal(identPub.length, 32)

    // 19. The two Ed25519 keypairs are distinct
    assert.notDeepEqual(botIdentPub, identPub)

    // Load and decrypt keystore
    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', io.env)]
    })
    const plaintext = await ks.load()

    // 15. bot_id and bot_token stored
    assert.equal(plaintext.bot_id, 'registered-bot-42')
    assert.equal(plaintext.bot_token, 'bot-secret-token')

    // 16. Private keys decode to 32 bytes
    assert.equal(Buffer.from(plaintext.bot_identity_private, 'base64url').length, 32)
    assert.equal(Buffer.from(plaintext.bot_command_private, 'base64url').length, 32)
    assert.equal(Buffer.from(plaintext.identity_private, 'base64url').length, 32)

    // 17. storage_seed decodes to 32 bytes
    assert.equal(Buffer.from(plaintext.storage_seed, 'base64url').length, 32)

    // 18. operator_session field populated
    assert.equal(plaintext.operator_session, 'operator-session-token-abc')

    // 20. created_at and rotated_at are ISO 8601
    assert.equal(typeof plaintext.created_at, 'string')
    assert.equal(typeof plaintext.rotated_at, 'string')
    assert.ok(!Number.isNaN(Date.parse(plaintext.created_at)))
    assert.ok(!Number.isNaN(Date.parse(plaintext.rotated_at)))

    // 21. stdout receives confirmation lines
    assert.match(io.out, /Registered bot registered-bot-42\./)
    assert.match(io.out, /Keystore written to/)
    assert.match(io.out, /Operator session cached\./)
  } finally {
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 23. 4xx response -> exit 1, message contains server error code', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  const server = await createMockServer()
  try {
    const serverUrl = await server.getUrl()
    const botPath = makeValidBotFile(tmp)

    server.setHandler('POST', '/api/v1/bots', (req, res) => {
      res.send(400, { error: 'invalid_scope' })
    })

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: serverUrl,
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', botPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /register failed: 400 invalid_scope/)
  } finally {
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 24. 5xx response -> exit 1 (no retries)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  const server = await createMockServer()
  try {
    const serverUrl = await server.getUrl()
    const botPath = makeValidBotFile(tmp)

    server.setHandler('POST', '/api/v1/bots', (req, res) => {
      res.send(500, { error: 'internal_error' })
    })

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: serverUrl,
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', botPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /register failed: 500/)

    // Assert only 1 request was attempted (retry: false)
    const reqs = server.requests.filter(r => r.method === 'POST' && r.path === '/api/v1/bots')
    assert.equal(reqs.length, 1)
  } finally {
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 25. Malformed success response -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  const server = await createMockServer()
  try {
    const serverUrl = await server.getUrl()
    const botPath = makeValidBotFile(tmp)

    server.setHandler('POST', '/api/v1/bots', (req, res) => {
      res.send(200, { status: 'ok' }) // missing bot_id and bot_token
    })

    const io = makeIO(tmp, {
      ATOL_SERVER_URL: serverUrl,
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    })
    const code = await dispatch(['register', botPath], io)
    assert.equal(code, 1)
    assert.match(io.err, /response did not include bot_id\/bot_token/)
  } finally {
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-register: 26. --force overwrites an existing keystore and rotates tokens', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reg-test-'))
  const server = await createMockServer()
  try {
    const serverUrl = await server.getUrl()
    const botPath = makeValidBotFile(tmp)

    let count = 0
    server.setHandler('POST', '/api/v1/bots', (req, res) => {
      count++
      res.send(200, { bot_id: 'bot-id-1', bot_token: `token-${count}` })
    })

    const env = {
      ATOL_SERVER_URL: serverUrl,
      ATOL_USER_TOKEN: 'user-token',
      ATOL_BOT_KEYSTORE_SECRET: 'secret'
    }

    const io1 = makeIO(tmp, env)
    const code1 = await dispatch(['register', botPath], io1)
    assert.equal(code1, 0)

    const ksPath = join(tmp, 'bot.keystore')
    const ks1 = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt1 = await ks1.load()
    assert.equal(pt1.bot_token, 'token-1')

    const io2 = makeIO(tmp, env)
    const code2 = await dispatch(['register', botPath, '--force'], io2)
    assert.equal(code2, 0)

    const ks2 = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt2 = await ks2.load()
    assert.equal(pt2.bot_token, 'token-2')
  } finally {
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})
