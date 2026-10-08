import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { dispatch, UserError } from '../../src/cli/index.js'
import { generateBotKeyMaterial } from '../../src/cli/keygen.js'
import { Keystore, createKeystore } from '../../src/runtime/keystore/index.js'
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

async function createFixtureKeystore (dir, secret = 'test-secret') {
  const ksPath = join(dir, 'bot.keystore')
  const material = generateBotKeyMaterial()
  const plaintext = {
    version: 1,
    bot_id: 'fixture-bot-id',
    bot_token: 'fixture-bot-token',
    bot_identity_private: Buffer.from(material.privateKeys.botIdentity).toString('base64url'),
    bot_command_private: Buffer.from(material.privateKeys.botCommand).toString('base64url'),
    identity_private: Buffer.from(material.privateKeys.identity).toString('base64url'),
    storage_seed: Buffer.from(material.storageSeed).toString('base64url'),
    operator_session: 'initial-operator-session',
    created_at: new Date().toISOString(),
    rotated_at: new Date().toISOString()
  }
  await createKeystore({ path: ksPath, secret, data: plaintext })
  return { ksPath, plaintext }
}

test('cli-login: 1. Missing --token and missing env -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    await createFixtureKeystore(tmp)
    const io = makeIO(tmp, { ATOL_BOT_KEYSTORE_SECRET: 'test-secret' })
    const code = await dispatch(['login'], io)
    assert.equal(code, 1)
    assert.match(io.err, /login requires --token or ATOL_USER_TOKEN/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-login: 2. --token value caches session', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const { ksPath } = await createFixtureKeystore(tmp)
    const env = { ATOL_BOT_KEYSTORE_SECRET: 'test-secret' }
    const io = makeIO(tmp, env)

    const code = await dispatch(['login', '--token', 'new-token-123'], io)
    assert.equal(code, 0)

    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt = await ks.load()
    assert.equal(pt.operator_session, 'new-token-123')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-login: 3. ATOL_USER_TOKEN env used when --token absent', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const { ksPath } = await createFixtureKeystore(tmp)
    const env = {
      ATOL_BOT_KEYSTORE_SECRET: 'test-secret',
      ATOL_USER_TOKEN: 'env-user-token'
    }
    const io = makeIO(tmp, env)

    const code = await dispatch(['login'], io)
    assert.equal(code, 0)

    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt = await ks.load()
    assert.equal(pt.operator_session, 'env-user-token')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-login: 4. --token wins over env var', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const { ksPath } = await createFixtureKeystore(tmp)
    const env = {
      ATOL_BOT_KEYSTORE_SECRET: 'test-secret',
      ATOL_USER_TOKEN: 'env-token'
    }
    const io = makeIO(tmp, env)

    const code = await dispatch(['login', '--token', 'flag-token'], io)
    assert.equal(code, 0)

    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt = await ks.load()
    assert.equal(pt.operator_session, 'flag-token')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-login: 5. Missing keystore -> exit 1, "keystore not found"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const io = makeIO(tmp, {
      ATOL_BOT_KEYSTORE_SECRET: 'test-secret',
      ATOL_USER_TOKEN: 'tok'
    })
    const code = await dispatch(['login'], io)
    assert.equal(code, 1)
    assert.match(io.err, /keystore not found/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-login: 6 & 9 & 10. Keystore passphrase from env used & stdout message & exit 0', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    await createFixtureKeystore(tmp, 'my-passphrase')
    const io = makeIO(tmp, {
      ATOL_BOT_KEYSTORE_SECRET: 'my-passphrase',
      ATOL_USER_TOKEN: 'token-xyz'
    })

    const code = await dispatch(['login'], io)
    assert.equal(code, 0)
    assert.match(io.out, /Operator session cached\./)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-login: 7. Wrong passphrase -> exit 1 with keystore-locked message', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    await createFixtureKeystore(tmp, 'correct-secret')
    const io = makeIO(tmp, {
      ATOL_BOT_KEYSTORE_SECRET: 'wrong-secret',
      ATOL_USER_TOKEN: 'token-xyz'
    })

    const code = await dispatch(['login'], io)
    assert.equal(code, 1)
    assert.match(io.err, /Decryption failed|No passphrase could be resolved/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-login: 8. login does not modify bot_token or key material', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const { ksPath, plaintext: orig } = await createFixtureKeystore(tmp)
    const env = { ATOL_BOT_KEYSTORE_SECRET: 'test-secret' }
    const io = makeIO(tmp, env)

    await dispatch(['login', '--token', 'updated-session'], io)

    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt = await ks.load()

    assert.equal(pt.bot_id, orig.bot_id)
    assert.equal(pt.bot_token, orig.bot_token)
    assert.equal(pt.bot_identity_private, orig.bot_identity_private)
    assert.equal(pt.bot_command_private, orig.bot_command_private)
    assert.equal(pt.identity_private, orig.identity_private)
    assert.equal(pt.storage_seed, orig.storage_seed)
    assert.equal(pt.operator_session, 'updated-session')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-logout: 11. Missing keystore -> exit 1', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const io = makeIO(tmp, { ATOL_BOT_KEYSTORE_SECRET: 'test-secret' })
    const code = await dispatch(['logout'], io)
    assert.equal(code, 1)
    assert.match(io.err, /keystore not found/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-logout: 12 & 15 & 16. logout clears operator_session field & prints message & exit 0', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const { ksPath } = await createFixtureKeystore(tmp)
    const env = { ATOL_BOT_KEYSTORE_SECRET: 'test-secret' }
    const io = makeIO(tmp, env)

    const code = await dispatch(['logout'], io)
    assert.equal(code, 0)
    assert.match(io.out, /Operator session cleared\./)

    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt = await ks.load()
    assert.equal(pt.operator_session, undefined)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-logout: 13. logout on a keystore without a session is a no-op (succeeds)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const { ksPath } = await createFixtureKeystore(tmp)
    const env = { ATOL_BOT_KEYSTORE_SECRET: 'test-secret' }

    // First logout
    await dispatch(['logout'], makeIO(tmp, env))

    // Second logout
    const io2 = makeIO(tmp, env)
    const code2 = await dispatch(['logout'], io2)
    assert.equal(code2, 0)
    assert.match(io2.out, /Operator session cleared\./)

    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt = await ks.load()
    assert.equal(pt.operator_session, undefined)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-logout: 14. logout does not modify bot_token or key material', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  try {
    const { ksPath, plaintext: orig } = await createFixtureKeystore(tmp)
    const env = { ATOL_BOT_KEYSTORE_SECRET: 'test-secret' }

    await dispatch(['logout'], makeIO(tmp, env))

    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })
    const pt = await ks.load()

    assert.equal(pt.bot_id, orig.bot_id)
    assert.equal(pt.bot_token, orig.bot_token)
    assert.equal(pt.bot_identity_private, orig.bot_identity_private)
    assert.equal(pt.bot_command_private, orig.bot_command_private)
    assert.equal(pt.identity_private, orig.identity_private)
    assert.equal(pt.storage_seed, orig.storage_seed)
    assert.equal(pt.operator_session, undefined)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('cli-roundtrip: 17. Register -> login -> logout round trip', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'log-test-'))
  const server = await createMockServer()
  try {
    const serverUrl = await server.getUrl()

    // 1. Create bot file
    const botPath = join(tmp, 'bot.js')
    const defineBotUrl = new URL('../../src/define-bot.js', import.meta.url).href
    const code = `
import { defineBot } from ${JSON.stringify(defineBotUrl)}
export default defineBot({
  id: 'rt.bot',
  hostApi: '1.0',
  capabilities: ['post_message'],
  handlers: { install () {} }
})
`
    writeFileSync(botPath, code, 'utf8')

    server.setHandler('POST', '/api/v1/bots', (req, res) => {
      res.send(200, { bot_id: 'rt-bot-id', bot_token: 'rt-bot-token' })
    })

    const env = {
      ATOL_SERVER_URL: serverUrl,
      ATOL_USER_TOKEN: 'initial-user-session',
      ATOL_BOT_KEYSTORE_SECRET: 'rt-secret'
    }

    // Step A: register
    const regRes = await dispatch(['register', botPath], makeIO(tmp, env))
    assert.equal(regRes, 0)

    const ksPath = join(tmp, 'bot.keystore')
    const ks = new Keystore({
      path: ksPath,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)]
    })

    let pt = await ks.load()
    assert.equal(pt.bot_id, 'rt-bot-id')
    assert.equal(pt.bot_token, 'rt-bot-token')
    assert.equal(pt.operator_session, 'initial-user-session')
    const originalIdentPriv = pt.bot_identity_private

    // Step B: login
    const loginRes = await dispatch(['login', '--token', 'updated-user-session'], makeIO(tmp, env))
    assert.equal(loginRes, 0)

    pt = await ks.load()
    assert.equal(pt.bot_id, 'rt-bot-id')
    assert.equal(pt.bot_token, 'rt-bot-token')
    assert.equal(pt.bot_identity_private, originalIdentPriv)
    assert.equal(pt.operator_session, 'updated-user-session')

    // Step C: logout
    const logoutRes = await dispatch(['logout'], makeIO(tmp, env))
    assert.equal(logoutRes, 0)

    pt = await ks.load()
    assert.equal(pt.bot_id, 'rt-bot-id')
    assert.equal(pt.bot_token, 'rt-bot-token')
    assert.equal(pt.bot_identity_private, originalIdentPriv)
    assert.equal(pt.operator_session, undefined)
  } finally {
    await server.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})
