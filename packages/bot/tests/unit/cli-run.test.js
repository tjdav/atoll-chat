import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { dispatch } from '../../src/cli/index.js'
import { createKeystore } from '../../src/runtime/keystore/index.js'
import { ValidationError, KeystoreLockedError, HttpRequestError } from '../../src/errors.js'

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

async function writeKeystore (ksPath, secret, botId = 'b_test') {
  await createKeystore({
    path: ksPath,
    secret,
    data: {
      version: 1,
      bot_id: botId,
      bot_token: 'test-bot-token',
      bot_identity_private: Buffer.alloc(32, 0x11).toString('base64url'),
      bot_command_private: Buffer.alloc(32, 0x22).toString('base64url'),
      identity_private: Buffer.alloc(32, 0x33).toString('base64url'),
      storage_seed: Buffer.alloc(32, 0x44).toString('base64url'),
      created_at: new Date(0).toISOString(),
      rotated_at: new Date(0).toISOString()
    }
  })
}

function writeBotFile (dir, name = 'bot.js', extraConfig = '') {
  const filePath = path.join(dir, name)
  writeFileSync(filePath, `
    import { defineBot } from '${process.cwd()}/src/define-bot.js'
    export default defineBot({
      id: 'com.example.run',
      apiVersion: '1.0',
      hostApi: '1.0',
      label: 'Run Bot',
      capabilities: ['post_message'],
      handlers: { install: () => {} }
      ${extraConfig}
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

async function runAndEmitSignal (args, io, signal = 'SIGINT', secondSignal = null) {
  const runPromise = dispatch(args, io)
  while (!io.getStdout().includes('Ready.')) {
    await new Promise((r) => setTimeout(r, 5))
  }
  emitSignalSafely(signal)
  if (secondSignal) {
    emitSignalSafely(secondSignal)
  }
  return runPromise
}

describe('cli-run Subcommand', { concurrency: 1 }, () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-run-test-'))
  })

  afterEach(async () => {
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // Path handling
  describe('Path handling', { concurrency: 1 }, () => {
    test('1. Missing path -> exit 1, "requires a path"', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['run'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('run requires a path to a bot file'))
    })

    test('2. Nonexistent file -> exit 1, "file not found"', async () => {
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['run', './nonexistent.js'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('file not found'))
    })

    test('3. A file that fails to import -> exit 1, "failed to load"', async () => {
      const badFile = path.join(tmpDir, 'bad.js')
      await fs.writeFile(badFile, 'import { nonexistent } from "nonexistent-module-xyz";')
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['run', './bad.js'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('failed to load'))
    })

    test('4. A file whose default export is not a Bot -> exit 1', async () => {
      const notBot = path.join(tmpDir, 'notbot.js')
      await fs.writeFile(notBot, 'export default { not: "a bot" };')
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['run', './notbot.js'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('default export is not a Bot'))
    })

    test('5. A file whose config fails validation -> exit 1, includes failure list', async () => {
      const invalidBot = path.join(tmpDir, 'invalid.js')
      await fs.writeFile(invalidBot, `
        export default {
          config: {
            id: 'INVALID ID WITH SPACES',
            apiVersion: '1.0',
            hostApi: '1.0',
            label: 'Invalid',
            capabilities: []
          }
        };
      `)
      const io = makeIo({ cwd: tmpDir })
      const code = await dispatch(['run', './invalid.js'], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('validation failed'))
    })
  })

  // Config loading
  describe('Config loading', { concurrency: 1 }, () => {
    test('6. Missing ATOL_SERVER_URL -> exit 1', async () => {
      const botFile = writeBotFile(tmpDir)
      const io = makeIo({
        cwd: tmpDir,
        env: { ATOL_BOT_KEYSTORE_SECRET: 'secret123' }
      })
      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
    })

    test('7. Missing ATOL_BOT_KEYSTORE_SECRET -> exit 1', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080'
          // ATOL_BOT_KEYSTORE_SECRET missing and resolvers fail
        }
      })
      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
    })

    test('8. ATOL_BOT_KEYSTORE path is used when set', async () => {
      const botFile = writeBotFile(tmpDir)
      const customKsPath = path.join(tmpDir, 'custom.keystore')
      await writeKeystore(customKsPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE: customKsPath,
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io)

      assert.equal(code, 0)
      assert.equal(instances[0].deps.config.keystorePath, customKsPath)
    })

    test('9. Default path (<cwd>/bot.keystore) is used when unset', async () => {
      const botFile = writeBotFile(tmpDir)
      const defaultKsPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(defaultKsPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io)

      assert.equal(code, 0)
      assert.equal(instances[0].deps.config.keystorePath, defaultKsPath)
    })
  })

  // Keystore loading
  describe('Keystore loading', { concurrency: 1 }, () => {
    test('10. Missing keystore -> exit 1, "keystore not found"', async () => {
      const botFile = writeBotFile(tmpDir)
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        }
      })
      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('keystore not found'))
    })

    test('11. Locked keystore (wrong secret) -> exit 1, message mentions locked', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'WRONG_SECRET'
        }
      })
      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('keystore locked'))
    })

    test('12. Corrupt keystore -> exit 1, message mentions corrupt', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await fs.writeFile(ksPath, 'corrupt data')

      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        }
      })
      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
      assert.ok(io.getStderr().includes('keystore corrupt'))
    })

    test('13. A valid keystore loads and populates the runtime\'s keystoreData', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123', 'b_test123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io)

      assert.equal(code, 0)
      assert.equal(instances[0].deps.keystoreData.bot_id, 'b_test123')
    })
  })

  // Runtime construction
  describe('Runtime construction', { concurrency: 1 }, () => {
    test('14. The runtime factory receives bot, config, keystoreData, and logger', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123', 'b_test')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      const deps = instances[0].deps
      assert.ok(deps.bot && typeof deps.bot === 'object')
      assert.ok(deps.config && typeof deps.config === 'object')
      assert.ok(deps.keystoreData && typeof deps.keystoreData === 'object')
      assert.ok(deps.logger && typeof deps.logger === 'object')
    })

    test('15. runtime.start() is called', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.equal(instances[0].started, true)
    })

    test('16. The fake runtime\'s started flag is set', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.equal(instances[0].started, true)
    })
  })

  // Startup output
  describe('Startup output', { concurrency: 1 }, () => {
    test('17. io.stdout receives "Starting bot <id>."', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.ok(io.getStdout().includes('Starting bot com.example.run.'))
    })

    test('18. io.stdout receives the keystore path', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.ok(io.getStdout().includes(`Keystore: ${ksPath}`))
    })

    test('19. The webhook line is printed when config.webhook.port is set and bot has webhook triggers', async () => {
      const botFile = writeBotFile(tmpDir, 'webhook-bot.js', `,
        triggers: [{ type: 'webhook', path: '/hook' }]
      `)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123',
          ATOL_BOT_PORT: '9090'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.ok(io.getStdout().includes('Webhooks: http://0.0.0.0:9090'))
    })
  })

  // Signal handling and shutdown
  describe('Signal handling and shutdown', { concurrency: 1 }, () => {
    test('20. SIGINT triggers shutdown', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io, 'SIGINT')

      assert.equal(code, 0)
      assert.equal(instances[0].stopped, true)
    })

    test('21. SIGTERM triggers shutdown', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io, 'SIGTERM')

      assert.equal(code, 0)
      assert.equal(instances[0].stopped, true)
    })

    test('22. The drain budget comes from config.shutdown.drainMs', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123',
          ATOL_SHUTDOWN_DRAIN_MS: '15000'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.equal(instances[0].stopCalls[0].drainMs, 15000)
    })

    test('23. A drained shutdown returns exit code 0', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory({ stopResult: { drained: true, remaining: 0 } })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io)

      assert.equal(code, 0)
    })

    test('24. A drain timeout returns exit code 1', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory({ stopResult: { drained: false, remaining: 2 } })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io)

      assert.equal(code, 1)
    })

    test('25. The exit code from runShutdownSequence is returned to the dispatcher', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory({ stopResult: { drained: false, remaining: 5 } })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await runAndEmitSignal(['run', botFile], io)

      assert.equal(code, 1)
    })

    test('26. A second signal during shutdown is ignored', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io, 'SIGINT', 'SIGINT')

      assert.equal(instances[0].stopCalls.length, 1)
    })
  })

  // Cleanup
  describe('Cleanup', { concurrency: 1 }, () => {
    test('27. Signal handlers are removed after shutdown', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      emitSignalSafely('SIGINT')
      assert.equal(instances[0].stopCalls.length, 1)
    })

    test('28. Signal handlers are removed when runtime.start() fails', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory({
        startThrows: new ValidationError('start failed')
      })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)

      emitSignalSafely('SIGINT')
      assert.equal(instances[0].stopCalls.length, 0)
    })
  })

  // Runtime start failures
  describe('Runtime start failures', { concurrency: 1 }, () => {
    test('29. A ValidationError from runtime.start() maps to exit 1', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory({
        startThrows: new ValidationError('validation failed')
      })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
    })

    test('30. A KeystoreLockedError from runtime.start() maps to exit 1', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory({
        startThrows: new KeystoreLockedError('keystore locked')
      })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
    })

    test('31. An http_request_failed error from runtime.start() maps to exit 1', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const httpErr = new HttpRequestError('HTTP request failed')
      const { factory } = makeFakeRuntimeFactory({ startThrows: httpErr })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
    })

    test('32. A generic Error from runtime.start() maps to exit 2', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory({
        startThrows: new Error('Unexpected null pointer exception')
      })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 2)
      assert.ok(io.getStderr().includes('internal error: Unexpected null pointer exception'))
    })

    test('33. An EADDRINUSE error from runtime.start() maps to exit 1', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const bindErr = new Error('listen EADDRINUSE: address already in use 0.0.0.0:8787')
      const { factory } = makeFakeRuntimeFactory({ startThrows: bindErr })
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      const code = await dispatch(['run', botFile], io)
      assert.equal(code, 1)
    })
  })

  // Logger
  describe('Logger', { concurrency: 1 }, () => {
    test('34. io.logger overrides the default logger', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      /** @type {Array<{ level: string, msg: string }>} */
      const logged = []
      const spyLogger = {
        log (level, msg) {
          logged.push({ level, msg })
        },
        info (msg) {
          logged.push({ level: 'info', msg })
        },
        warn (msg) {
          logged.push({ level: 'warn', msg })
        },
        error (msg) {
          logged.push({ level: 'error', msg })
        },
        debug (msg) {
          logged.push({ level: 'debug', msg })
        }
      }

      const { factory } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        logger: spyLogger,
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.ok(logged.some((entry) => entry.msg.includes('signal received, shutting down')))
    })

    test('35. The default logger writes to io.stderr', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://127.0.0.1:8080',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.ok(io.getStderr().length > 0)
      assert.equal(io.getStdout().includes('"level":'), false)
    })
  })

  // Env injection
  describe('Env injection', { concurrency: 1 }, () => {
    test('36. io.env overrides process.env', async () => {
      const botFile = writeBotFile(tmpDir)
      const ksPath = path.join(tmpDir, 'bot.keystore')
      await writeKeystore(ksPath, 'secret123')

      const { factory, instances } = makeFakeRuntimeFactory()
      const io = makeIo({
        cwd: tmpDir,
        env: {
          ATOL_SERVER_URL: 'http://custom-server.example.com:9999',
          ATOL_BOT_KEYSTORE_SECRET: 'secret123'
        },
        runtimeFactory: factory
      })

      await runAndEmitSignal(['run', botFile], io)

      assert.equal(instances[0].deps.config.serverUrl, 'http://custom-server.example.com:9999')
    })
  })

  test('37. Diagnostic check for clean process signal listeners at test suite end', () => {
    assert.equal(process.listenerCount('SIGINT'), 0)
    assert.equal(process.listenerCount('SIGTERM'), 0)
  })
})
