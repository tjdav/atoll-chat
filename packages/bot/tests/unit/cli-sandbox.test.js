import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs, writeFileSync, chmodSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { dispatch } from '../../src/cli/index.js'
import { createKeystore } from '../../src/runtime/keystore/index.js'
import { createMockServer } from '../../src/testing/mock-server.js'

function makeIo (overrides = {}) {
  let stdoutBuf = ''
  let stderrBuf = ''
  const ioObj = {
    stdout: {
      write (str) {
        stdoutBuf += str
        return true
      }
    },
    stderr: {
      write (str) {
        stderrBuf += str
        return true
      }
    },
    getStdout () {
      return stdoutBuf
    },
    getStderr () {
      return stderrBuf
    },
    ...overrides
  }
  return ioObj
}

async function writeSandboxKeystore (ksPath, secret = 'secret123', overrides = {}) {
  await createKeystore({
    path: ksPath,
    secret,
    data: {
      version: 1,
      bot_id: 'b_sandbox123',
      bot_token: 'sandbox-bot-token',
      bot_identity_private: Buffer.alloc(32, 0x11).toString('base64url'),
      bot_command_private: Buffer.alloc(32, 0x22).toString('base64url'),
      identity_private: Buffer.alloc(32, 0x33).toString('base64url'),
      storage_seed: Buffer.alloc(32, 0x44).toString('base64url'),
      operator_session: undefined,
      sandbox_url: 'http://127.0.0.1:8080',
      created_at: new Date(0).toISOString(),
      rotated_at: new Date(0).toISOString(),
      ...overrides
    }
  })
}

function writeBotFile (dir, name = 'bot.js') {
  const filePath = path.join(dir, name)
  writeFileSync(filePath, `
    import { defineBot } from '${process.cwd()}/src/define-bot.js'
    export default defineBot({
      id: 'com.example.sandbox',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Sandbox Bot',
      capabilities: ['post_message'],
      handlers: { install: () => {} }
    })
  `)
  return filePath
}

function makeFakeRuntimeFactory (behavior = {}) {
  const instances = []
  const factory = (deps) => {
    const runtime = {
      deps,
      started: false,
      stopped: false,
      stopCalls: [],
      async start () {
        runtime.started = true
        if (behavior.startThrows) throw behavior.startThrows
      },
      async stop (opts) {
        runtime.stopped = true
        runtime.stopCalls.push(opts)
        return behavior.stopResult ?? { drained: true, remaining: 0 }
      }
    }
    instances.push(runtime)
    return runtime
  }
  return { factory, instances }
}

function emitSignalSafely (signal = 'SIGINT') {
  const listeners = process.listeners(signal)
  const harnessListeners = listeners.filter((fn) => fn.name !== 'sigintListener' && fn.name !== 'sigtermListener')
  for (const fn of harnessListeners) {
    process.off(signal, fn)
  }
  process.emit(signal)
  for (const fn of harnessListeners) {
    process.on(signal, fn)
  }
}

async function runAndEmitSignal (args, io, signal = 'SIGINT') {
  const runPromise = dispatch(args, io)
  while (!io.getStdout().includes('Ready.')) {
    await new Promise((r) => setTimeout(r, 5))
  }
  emitSignalSafely(signal)
  return runPromise
}

describe('cli-sandbox Subcommands', { concurrency: 1 }, () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-sandbox-test-'))
  })

  afterEach(async () => {
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    if (tmpDir) {
      await fs.chmod(tmpDir, 0o755).catch(() => {})
      const readOnlySubDir = path.join(tmpDir, 'readonly-dir')
      await fs.chmod(readOnlySubDir, 0o755).catch(() => {})
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // sandbox dispatcher tests
  describe('sandbox dispatcher', { concurrency: 1 }, () => {
    test('1. No sub-subcommand -> exit 1, message lists choices', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox requires a subcommand: connect, run, or reset'))
    })

    test('2. Unknown sub-subcommand -> exit 1', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'unknown'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('unknown sandbox subcommand: unknown'))
    })

    test('3. connect is dispatched', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'connect'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox connect requires a URL'))
    })

    test('4. run is dispatched', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'run'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox run requires a path'))
    })

    test('5. reset is dispatched', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'reset'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox keystore not found'))
    })
  })

  // sandbox connect tests
  describe('sandbox connect', { concurrency: 1 }, () => {
    test('6. Missing URL -> exit 1', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'connect'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox connect requires a URL'))
    })

    test('7. Invalid URL scheme -> exit 1', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'connect', 'ftp://sandbox.example.com'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('not a valid http(s) URL'))
    })

    test('8. Missing token -> exit 1', async () => {
      const io = makeIo({ cwd: tmpDir, env: {} })
      const code = await dispatch(['sandbox', 'connect', 'http://127.0.0.1:8080'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('requires --token or ATOL_SANDBOX_TOKEN'))
    })

    test('9. Missing ATOL_BOT_KEYSTORE_SECRET -> exit 1', async () => {
      const io = makeIo({ cwd: tmpDir, env: { ATOL_SANDBOX_TOKEN: 'tok123' } })
      const code = await dispatch(['sandbox', 'connect', 'http://127.0.0.1:8080'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('requires ATOL_BOT_KEYSTORE_SECRET'))
    })

    test('10. Missing bot file -> exit 1', async () => {
      const io = makeIo({
        cwd: tmpDir,
        env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' }
      })
      const code = await dispatch(['sandbox', 'connect', 'http://127.0.0.1:8080'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('requires a bot file path'))
    })

    test('11. Bot file fails to load -> exit 1', async () => {
      const badBot = path.join(tmpDir, 'bad-bot.js')
      await fs.writeFile(badBot, 'import nonexistent from "nonexistent-module-xyz";')
      const io = makeIo({
        cwd: tmpDir,
        env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' }
      })
      const code = await dispatch(['sandbox', 'connect', 'http://127.0.0.1:8080', badBot], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('failed to load'))
    })

    test('12. POST to /api/v1/bots has the correct body', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        let receivedBody = null
        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          receivedBody = req.json
          res.send(201, { bot_id: 'b_sb_1', bot_token: 'sb_tok_1' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 0)
        assert.ok(receivedBody)
        assert.equal(receivedBody.display_name, 'Sandbox Bot')
        assert.ok(typeof receivedBody.bot_identity_pubkey === 'string')
        assert.ok(typeof receivedBody.bot_command_pubkey === 'string')
        assert.ok(typeof receivedBody.identity_pubkey === 'string')
        assert.deepEqual(receivedBody.declared_scopes, ['post_message'])
      } finally {
        await mockServer.close()
      }
    })

    test('13. Authorization header carries the sandbox token', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        let receivedAuth = null
        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          receivedAuth = req.headers.authorization
          res.send(201, { bot_id: 'b_sb_1', bot_token: 'sb_tok_1' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'custom_sandbox_token', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 0)
        assert.equal(receivedAuth, 'Bearer custom_sandbox_token')
      } finally {
        await mockServer.close()
      }
    })

    test('14. The keystore is written to the sandbox path', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          res.send(201, { bot_id: 'b_sb_1', bot_token: 'sb_tok_1' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const expectedKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 0)
        assert.doesNotThrow(() => statSync(expectedKsPath))
      } finally {
        await mockServer.close()
      }
    })

    test('15. The keystore\'s sandbox_url field matches the input URL', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          res.send(201, { bot_id: 'b_sb_1', bot_token: 'sb_tok_1' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const expectedKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl() + '/', botFile], io)
        assert.equal(code, 0)

        const { Keystore } = await import('../../src/runtime/keystore/index.js')
        const { envResolver } = await import('../../src/runtime/keystore/resolvers/env.js')
        const ks = new Keystore({
          path: expectedKsPath,
          resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', io.env)]
        })
        const data = await ks.load()
        assert.equal(data.sandbox_url, mockServer.getUrl())
      } finally {
        await mockServer.close()
      }
    })

    test('16. The keystore\'s bot_id and bot_token match the response', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          res.send(201, { bot_id: 'b_sb_99', bot_token: 'sb_tok_99' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const expectedKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 0)

        const { Keystore } = await import('../../src/runtime/keystore/index.js')
        const { envResolver } = await import('../../src/runtime/keystore/resolvers/env.js')
        const ks = new Keystore({
          path: expectedKsPath,
          resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', io.env)]
        })
        const data = await ks.load()
        assert.equal(data.bot_id, 'b_sb_99')
        assert.equal(data.bot_token, 'sb_tok_99')
      } finally {
        await mockServer.close()
      }
    })

    test('17. Existing keystore without --force -> exit 1', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        const ksPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(ksPath, 'sec123')

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 1)
        assert.ok(io.getStderr().includes('sandbox keystore already exists'))
      } finally {
        await mockServer.close()
      }
    })

    test('18. Existing keystore with --force overwrites', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        const ksPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(ksPath, 'sec123', { bot_id: 'old_bot_id' })

        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          res.send(201, { bot_id: 'new_bot_id', bot_token: 'new_tok' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile, '--force'], io)
        assert.equal(code, 0)

        const { Keystore } = await import('../../src/runtime/keystore/index.js')
        const { envResolver } = await import('../../src/runtime/keystore/resolvers/env.js')
        const ks = new Keystore({
          path: ksPath,
          resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', io.env)]
        })
        const data = await ks.load()
        assert.equal(data.bot_id, 'new_bot_id')
      } finally {
        await mockServer.close()
      }
    })

    test('19. Server 4xx -> exit 1', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          res.send(400, { error: 'invalid_scope' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 1)
        assert.ok(io.getStderr().includes('sandbox connect failed: 400'))
      } finally {
        await mockServer.close()
      }
    })

    test('20. stdout receives the three confirmation lines', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          res.send(201, { bot_id: 'b_sb_77', bot_token: 'sb_tok_77' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const ksPath = path.join(tmpDir, 'bot.keystore.sandbox')
        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 0)

        const out = io.getStdout()
        assert.ok(out.includes('Sandbox bot registered: b_sb_77'))
        assert.ok(out.includes(`Keystore written to ${ksPath}`))
        assert.ok(out.includes(`Server: ${mockServer.getUrl()}`))
      } finally {
        await mockServer.close()
      }
    })

    test('21. The production keystore is not touched', async () => {
      const mockServer = await createMockServer()
      try {
        const botFile = writeBotFile(tmpDir)
        const prodKsPath = path.join(tmpDir, 'bot.keystore')
        await writeSandboxKeystore(prodKsPath, 'sec123', { bot_id: 'prod_bot' })
        const initialMtime = statSync(prodKsPath).mtimeMs

        mockServer.setHandler('POST', '/api/v1/bots', async (req, res) => {
          res.send(201, { bot_id: 'sandbox_bot', bot_token: 'sb_tok' })
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_SANDBOX_TOKEN: 'tok123', ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'connect', mockServer.getUrl(), botFile], io)
        assert.equal(code, 0)

        const finalMtime = statSync(prodKsPath).mtimeMs
        assert.equal(finalMtime, initialMtime)
      } finally {
        await mockServer.close()
      }
    })
  })

  // sandbox run tests
  describe('sandbox run', { concurrency: 1 }, () => {
    test('22. Missing bot file -> exit 1', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'run'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox run requires a path'))
    })

    test('23. Missing sandbox keystore -> exit 1, message mentions connect', async () => {
      const botFile = writeBotFile(tmpDir)
      const io = makeIo({ cwd: tmpDir, env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' } })
      const code = await dispatch(['sandbox', 'run', botFile], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox keystore not found; run atoll-bot sandbox connect first'))
    })

    test('24. The runtime factory\'s config.serverUrl equals the keystore\'s sandbox_url', async () => {
      const botFile = writeBotFile(tmpDir)
      const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
      await writeSandboxKeystore(sbKsPath, 'sec123', { sandbox_url: 'http://custom-sandbox.example.com:8888' })

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['sandbox', 'run', botFile], io)
      assert.equal(code, 0)
      assert.equal(instances[0].deps.config.serverUrl, 'http://custom-sandbox.example.com:8888')
    })

    test('25. ATOL_BOT_KEYSTORE is overridden with the sandbox path', async () => {
      const botFile = writeBotFile(tmpDir)
      const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
      await writeSandboxKeystore(sbKsPath, 'sec123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['sandbox', 'run', botFile], io)
      assert.equal(code, 0)
      assert.equal(instances[0].deps.config.keystorePath, sbKsPath)
    })

    test('26. The command delegates to run', async () => {
      const botFile = writeBotFile(tmpDir)
      const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
      await writeSandboxKeystore(sbKsPath, 'sec123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['sandbox', 'run', botFile], io)
      assert.equal(instances.length, 1)
      assert.equal(instances[0].started, true)
    })

    test('27. Signal shutdown returns 0', async () => {
      const botFile = writeBotFile(tmpDir)
      const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
      await writeSandboxKeystore(sbKsPath, 'sec123')

      const { factory } = makeFakeRuntimeFactory({ stopResult: { drained: true, remaining: 0 } })
      const io = makeIo({
        cwd: tmpDir,
        env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['sandbox', 'run', botFile], io)
      assert.equal(code, 0)
    })
  })

  // sandbox reset tests
  describe('sandbox reset', { concurrency: 1 }, () => {
    test('28. Missing keystore -> exit 1', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['sandbox', 'reset'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('sandbox keystore not found'))
    })

    test('29. DELETE /api/v1/bots/<id> is called', async () => {
      const mockServer = await createMockServer()
      try {
        let deletedId = null
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          deletedId = 'b_sandbox123'
          res.send(204)
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          bot_id: 'b_sandbox123',
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset'], io)
        assert.equal(code, 0)
        assert.equal(deletedId, 'b_sandbox123')
      } finally {
        await mockServer.close()
      }
    })

    test('30. Authorization carries the bot token', async () => {
      const mockServer = await createMockServer()
      try {
        let receivedAuth = null
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          receivedAuth = req.headers.authorization
          res.send(204)
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          bot_id: 'b_sandbox123',
          bot_token: 'token_for_reset',
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset'], io)
        assert.equal(code, 0)
        assert.equal(receivedAuth, 'Bearer token_for_reset')
      } finally {
        await mockServer.close()
      }
    })

    test('31. Success removes the local keystore', async () => {
      const mockServer = await createMockServer()
      try {
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          res.send(204)
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset'], io)
        assert.equal(code, 0)
        assert.throws(() => statSync(sbKsPath))
      } finally {
        await mockServer.close()
      }
    })

    test('32. 404 from the server is treated as success', async () => {
      const mockServer = await createMockServer()
      try {
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          res.send(404, { error: 'bot_not_found' })
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset'], io)
        assert.equal(code, 0)
        assert.throws(() => statSync(sbKsPath))
      } finally {
        await mockServer.close()
      }
    })

    test('33. 4xx (other than 404) -> exit 1, keystore kept', async () => {
      const mockServer = await createMockServer()
      try {
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          res.send(403, { error: 'forbidden' })
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset'], io)
        assert.equal(code, 1)
        assert.ok(io.getStderr().includes('sandbox reset failed: 403'))
        assert.doesNotThrow(() => statSync(sbKsPath))
      } finally {
        await mockServer.close()
      }
    })

    test('34. --keep-remote skips the DELETE', async () => {
      const mockServer = await createMockServer()
      try {
        let deleteCalled = false
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          deleteCalled = true
          res.send(204)
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset', '--keep-remote'], io)
        assert.equal(code, 0)
        assert.equal(deleteCalled, false)
        assert.throws(() => statSync(sbKsPath))
      } finally {
        await mockServer.close()
      }
    })

    test('35. --keep-local skips the file removal', async () => {
      const mockServer = await createMockServer()
      try {
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          res.send(204)
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset', '--keep-local'], io)
        assert.equal(code, 0)
        assert.doesNotThrow(() => statSync(sbKsPath))
      } finally {
        await mockServer.close()
      }
    })

    test('36. stdout receives the confirmation lines', async () => {
      const mockServer = await createMockServer()
      try {
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          res.send(204)
        })

        const sbKsPath = path.join(tmpDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          bot_id: 'b_sandbox123',
          sandbox_url: mockServer.getUrl()
        })

        const io = makeIo({
          cwd: tmpDir,
          env: { ATOL_BOT_KEYSTORE_SECRET: 'sec123' },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset'], io)
        assert.equal(code, 0)
        const out = io.getStdout()
        assert.ok(out.includes('Sandbox bot b_sandbox123 deleted.'))
        assert.ok(out.includes(`Sandbox keystore removed: ${sbKsPath}`))
      } finally {
        await mockServer.close()
      }
    })

    test('37. Local file delete failure -> exit 2', async () => {
      const mockServer = await createMockServer()
      try {
        mockServer.setHandler('DELETE', '/api/v1/bots/b_sandbox123', async (req, res) => {
          res.send(204)
        })

        const readOnlySubDir = path.join(tmpDir, 'readonly-dir')
        await fs.mkdir(readOnlySubDir, { recursive: true })
        const sbKsPath = path.join(readOnlySubDir, 'bot.keystore.sandbox')
        await writeSandboxKeystore(sbKsPath, 'sec123', {
          sandbox_url: mockServer.getUrl()
        })

        chmodSync(readOnlySubDir, 0o555)

        const io = makeIo({
          cwd: tmpDir,
          env: {
            ATOL_BOT_SANDBOX_KEYSTORE: sbKsPath,
            ATOL_BOT_KEYSTORE_SECRET: 'sec123'
          },
          fetchImpl: globalThis.fetch
        })

        const code = await dispatch(['sandbox', 'reset'], io)
        assert.equal(code, 2)
        assert.ok(io.getStderr().includes('internal error:'))
      } finally {
        await mockServer.close()
      }
    })
  })
})
