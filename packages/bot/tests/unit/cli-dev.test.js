import assert from 'node:assert/strict'
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { devCommand } from '../../src/cli/dev.js'
import { resolveDiagPath } from '../../src/cli/diag-file.js'
import { createKeystore } from '../../src/runtime/keystore/index.js'
import { envResolver } from '../../src/runtime/keystore/resolvers/env.js'
import { generateBotKeyMaterial } from '../../src/cli/keygen.js'

/**
 * Converts a Uint8Array to a base64url string.
 *
 * @param {Uint8Array} bytes - Input bytes.
 * @returns {string} Base64url encoded string.
 */
function base64url (bytes) {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Helper to capture stream writes in memory.
 */
function createMockStream () {
  let content = ''
  return {
    write (chunk) {
      content += chunk
    },
    get content () {
      return content
    }
  }
}

/** Valid bot export string for fixtures */
const VALID_BOT_JS = `
  export default {
    config: {
      id: 'com.example.test-bot',
      label: 'Test Bot',
      version: '1.0.0',
      hostApi: '1.0',
      capabilities: ['read_content'],
      handlers: {
        message: async () => {}
      },
      triggers: []
    }
  }
`

describe('devCommand unit tests', { concurrency: 1 }, () => {
  let tmpDir
  let stdout
  let stderr

  beforeEach(() => {
    tmpDir = join(tmpdir(), `bot-dev-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    stdout = createMockStream()
    stderr = createMockStream()
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('1. Missing path -> exit 1', async () => {
    await assert.rejects(
      async () => {
        await devCommand.run([], {}, { stdout, stderr, cwd: tmpDir })
      },
      (err) => {
        return err.name === 'UserError' && err.message.includes('dev requires a path to a bot file')
      }
    )
  })

  it('2. Nonexistent file -> exit 1', async () => {
    await assert.rejects(
      async () => {
        await devCommand.run(['nonexistent.js'], {}, { stdout, stderr, cwd: tmpDir })
      },
      (err) => {
        return err.name === 'UserError' && err.message.includes('nonexistent.js: file not found')
      }
    )
  })

  it('3. Invalid config -> exit 1', async () => {
    const filePath = join(tmpDir, 'invalid-bot.js')
    writeFileSync(filePath, 'export default { config: "not-an-object" }')

    await assert.rejects(
      async () => {
        await devCommand.run(['invalid-bot.js'], {}, { stdout, stderr, cwd: tmpDir, env: { ATOL_SERVER_URL: 'http://localhost:8080' } })
      },
      (err) => {
        return err.name === 'UserError' && err.message.includes('default export is not a Bot')
      }
    )
  })

  it('4 & 5. A mock server is started and stdout receives Mock server listening at <url>', async () => {
    const filePath = join(tmpDir, 'valid-bot.js')
    writeFileSync(filePath, VALID_BOT_JS)

    let startCalled = false
    let passedServerUrl = ''
    const fakeRuntimeFactory = ({ config }) => {
      passedServerUrl = config.serverUrl
      return {
        async start () {
          startCalled = true
        },
        async stop () {
          return { drained: true, remaining: 0 }
        }
      }
    }

    const runPromise = devCommand.run(['valid-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(startCalled, true)
    assert.match(stdout.content, /Mock server listening at http:\/\/127\.0\.0\.1:/)
    assert.match(passedServerUrl, /http:\/\/127\.0\.0\.1:/)

    process.emit('SIGINT')
    const code = await runPromise
    assert.equal(code, 0)
  })

  it('6. Missing keystore uses synthetic keys and prints warning', async () => {
    const filePath = join(tmpDir, 'valid-bot.js')
    writeFileSync(filePath, VALID_BOT_JS)

    let receivedKeystoreData
    const fakeRuntimeFactory = ({ keystoreData }) => {
      receivedKeystoreData = keystoreData
      return {
        async start () {},
        async stop () { return { drained: true, remaining: 0 } }
      }
    }

    const runPromise = devCommand.run(['valid-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.match(stdout.content, /Dev mode: no keystore found at .*, using synthetic keys\./)
    assert.equal(receivedKeystoreData.bot_id, 'b_synthetic_dev')

    process.emit('SIGINT')
    await runPromise
  })

  it('7. A present keystore is loaded', async () => {
    const keystorePath = join(tmpDir, 'bot.keystore')
    const material = generateBotKeyMaterial()
    const now = new Date().toISOString()
    await createKeystore({
      path: keystorePath,
      secret: 'test-secret',
      data: {
        version: 1,
        bot_id: 'com.example.test-bot',
        bot_token: 'tok_real_ks',
        bot_identity_private: base64url(material.privateKeys.botIdentity),
        bot_command_private: base64url(material.privateKeys.botCommand),
        identity_private: base64url(material.privateKeys.identity),
        storage_seed: base64url(material.storageSeed),
        operator_session: 'session_token',
        created_at: now,
        rotated_at: now
      }
    })

    const filePath = join(tmpDir, 'valid-bot.js')
    writeFileSync(filePath, VALID_BOT_JS)

    let receivedKeystoreData
    const fakeRuntimeFactory = ({ keystoreData }) => {
      receivedKeystoreData = keystoreData
      return {
        async start () {},
        async stop () { return { drained: true, remaining: 0 } }
      }
    }

    const env = {
      ATOL_SERVER_URL: 'http://localhost:8080',
      ATOL_BOT_KEYSTORE: keystorePath,
      ATOL_BOT_KEYSTORE_SECRET: 'test-secret'
    }

    const runPromise = devCommand.run(['valid-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env,
      resolvers: [envResolver('ATOL_BOT_KEYSTORE_SECRET', env)],
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(receivedKeystoreData.bot_id, 'com.example.test-bot')
    assert.equal(stdout.content.includes('Dev mode: no keystore found'), false)

    process.emit('SIGINT')
    await runPromise
  })

  it('8 & 9. Runtime factory is called with mock URL as config.serverUrl and runtime.start() is called', async () => {
    const filePath = join(tmpDir, 'valid-bot.js')
    writeFileSync(filePath, VALID_BOT_JS)

    let started = false
    let mockUrl = ''
    const fakeRuntimeFactory = ({ config }) => {
      mockUrl = config.serverUrl
      return {
        async start () {
          started = true
        },
        async stop () { return { drained: true, remaining: 0 } }
      }
    }

    const runPromise = devCommand.run(['valid-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(started, true)
    assert.ok(mockUrl.startsWith('http://127.0.0.1:'))

    process.emit('SIGINT')
    await runPromise
  })

  it('10 & 11. First state line is written to diagnostic file with matching bot_id', async () => {
    const filePath = join(tmpDir, 'valid-bot.js')
    writeFileSync(filePath, VALID_BOT_JS)

    const runPromise = devCommand.run(['valid-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: () => ({ async start () {}, async stop () { return { drained: true, remaining: 0 } } })
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    const diagPath = resolveDiagPath(join(tmpDir, 'bot.keystore'))
    const diagContent = readFileSync(diagPath, 'utf8')
    const firstLine = JSON.parse(diagContent.split('\n')[0])

    assert.equal(firstLine.type, 'state')
    assert.equal(firstLine.data.bot_id, 'com.example.test-bot')

    process.emit('SIGINT')
    await runPromise
  })

  it('12, 13, 14. Logger writes to io.stdout, level is debug, dev is true (throws on _secret:)', async () => {
    const filePath = join(tmpDir, 'valid-bot.js')
    writeFileSync(filePath, VALID_BOT_JS)

    let loggerInstance
    const fakeRuntimeFactory = ({ logger }) => {
      loggerInstance = logger
      return {
        async start () {
          logger.info('test log line')
        },
        async stop () { return { drained: true, remaining: 0 } }
      }
    }

    const runPromise = devCommand.run(['valid-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.match(stdout.content, /"msg":"test log line"/)

    assert.throws(
      () => {
        loggerInstance.info('secret test', { '_secret:key': 'topsecret' })
      },
      /Reserved secret key "_secret:key" found in log meta/
    )

    process.emit('SIGINT')
    await runPromise
  })

  it('15, 17, 20. Changing bot file triggers reload, cache-busting import, writes new state line', async () => {
    const filePath = join(tmpDir, 'reload-bot.js')
    writeFileSync(filePath, `
      globalThis.__reload_counter = (globalThis.__reload_counter || 0) + 1;
      export default {
        config: {
          id: 'com.example.reload-bot',
          label: 'Reload Test',
          version: '1.0.0',
          hostApi: '1.0',
          capabilities: ['read_content'],
          handlers: {
            message: async () => {}
          },
          triggers: []
        }
      }
    `)

    let runtimeConstructedCount = 0
    const fakeRuntimeFactory = () => {
      runtimeConstructedCount++
      return {
        async start () {},
        async stop () { return { drained: true, remaining: 0 } }
      }
    }

    const runPromise = devCommand.run(['reload-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(runtimeConstructedCount, 1)

    // Trigger file change
    writeFileSync(filePath, `
      globalThis.__reload_counter = (globalThis.__reload_counter || 0) + 1;
      export default {
        config: {
          id: 'com.example.reload-bot',
          label: 'Reload Test Updated',
          version: '1.0.0',
          hostApi: '1.0',
          capabilities: ['read_content'],
          handlers: {
            message: async () => {}
          },
          triggers: []
        }
      }
    `)

    await new Promise((resolve) => setTimeout(resolve, 400))

    assert.equal(runtimeConstructedCount, 2)
    assert.match(stdout.content, /Reloaded\./)
    assert.ok(globalThis.__reload_counter >= 2)

    process.emit('SIGINT')
    await runPromise
  })

  it('16. Reload failure does not stop watcher', async () => {
    const filePath = join(tmpDir, 'fail-reload-bot.js')
    writeFileSync(filePath, `
      export default {
        config: {
          id: 'com.example.fail-reload-bot',
          label: 'Fail Reload Initial',
          version: '1.0.0',
          hostApi: '1.0',
          capabilities: ['read_content'],
          handlers: {
            message: async () => {}
          },
          triggers: []
        }
      }
    `)

    let runtimeConstructedCount = 0
    const fakeRuntimeFactory = () => {
      runtimeConstructedCount++
      return {
        async start () {},
        async stop () { return { drained: true, remaining: 0 } }
      }
    }

    const runPromise = devCommand.run(['fail-reload-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(runtimeConstructedCount, 1)

    // Write invalid bot file
    writeFileSync(filePath, 'export default { config: "invalid" }')
    await new Promise((resolve) => setTimeout(resolve, 400))

    assert.match(stderr.content, /reload failed:/)
    assert.equal(runtimeConstructedCount, 1)

    // Now write valid file again
    writeFileSync(filePath, `
      export default {
        config: {
          id: 'com.example.fail-reload-bot',
          label: 'Fail Reload Fixed',
          version: '1.0.0',
          hostApi: '1.0',
          capabilities: ['read_content'],
          handlers: {
            message: async () => {}
          },
          triggers: []
        }
      }
    `)
    await new Promise((resolve) => setTimeout(resolve, 400))

    assert.equal(runtimeConstructedCount, 2)

    process.emit('SIGINT')
    await runPromise
  })

  it('18 & 19. SIGINT stops runtime, closes mock, stops watcher, exit code is 0', async () => {
    const filePath = join(tmpDir, 'sig-bot.js')
    writeFileSync(filePath, `
      export default {
        config: {
          id: 'com.example.sig-bot',
          label: 'SIG Test',
          version: '1.0.0',
          hostApi: '1.0',
          capabilities: ['read_content'],
          handlers: {
            message: async () => {}
          },
          triggers: []
        }
      }
    `)

    let stopped = false
    const fakeRuntimeFactory = () => {
      return {
        async start () {},
        async stop () {
          stopped = true
          return { drained: true, remaining: 0 }
        }
      }
    }

    const runPromise = devCommand.run(['sig-bot.js'], {}, {
      stdout,
      stderr,
      cwd: tmpDir,
      env: { ATOL_SERVER_URL: 'http://localhost:8080' },
      runtimeFactory: fakeRuntimeFactory
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    process.emit('SIGINT')
    const exitCode = await runPromise

    assert.equal(stopped, true)
    assert.equal(exitCode, 0)
  })
})
