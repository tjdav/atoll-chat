import { spawn, execSync } from 'child_process'
import { chromium } from '@playwright/test'
import { run, bench, group } from 'mitata'
import fs, { existsSync } from 'fs'
import path from 'path'
import net from 'net'
import { fileURLToPath } from 'url'
import PocketBase from 'pocketbase'
import sodium from 'libsodium-wrappers-sumo'
import { deriveAuthAndVaultKeys } from '../../src/utils/keys.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

// Setup paths
const resultsMdPath = path.join(projectRoot, 'docs/benchmark-results.md')
const resultsJsonPath = path.join(projectRoot, 'docs/benchmark-results.json')

// Get custom executable path if exists
const getExecutablePath = (p) => (existsSync(p) ? p : undefined)
const executablePath = getExecutablePath('/usr/bin/google-chrome') || getExecutablePath('/usr/bin/chromium')

// Keep track of spawned child processes to clean them up on exit
const childProcesses = []

/**
 * Clean up all child processes on exit.
 */
function cleanup () {
  if (process.env.ATOLL_SKIP_SERVERS) {
    return
  }
  console.log('\n--- Cleaning up benchmark servers ---')
  for (const proc of childProcesses) {
    try {
      proc.kill('SIGINT')
    } catch {
      /* ignore */
    }
  }
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(1)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(1)
})

/**
 * Check if a port is open and accepting socket connections.
 * @param {number} port - The port to check.
 * @returns {Promise<boolean>} Resolves to true if open.
 */
function waitForPort (port) {
  return new Promise((resolve) => {
    const check = () => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        setTimeout(check, 250)
      })
      socket.once('timeout', () => {
        socket.destroy()
        setTimeout(check, 250)
      })
      socket.connect(port)
    }
    check()
  })
}

/**
 * Generate 16-byte random salt.
 * @param {object} sodium - Libsodium sumo wrappers instance.
 * @returns {Uint8Array} The 16-byte random salt.
 */
function generateSalt (sodium) {
  return sodium.randombytes_buf(16)
}

/**
 * Generate cryptographic master keys.
 * @param {object} sodium - Libsodium sumo wrappers instance.
 * @returns {Promise<object>} The generated public and private master keys.
 */
async function generateMasterKeys (sodium) {
  const { publicKey: pubBox, privateKey: privBox } = sodium.crypto_box_keypair()
  const { publicKey: pubSign, privateKey: privSign } = sodium.crypto_sign_keypair()

  return {
    public_box_key: sodium.to_base64(pubBox, sodium.base64_variants.ORIGINAL),
    private_box_key: sodium.to_base64(privBox, sodium.base64_variants.ORIGINAL),
    public_sign_key: sodium.to_base64(pubSign, sodium.base64_variants.ORIGINAL),
    private_sign_key: sodium.to_base64(privSign, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Encrypt private keys with master key.
 * @param {object} privateKeys - Key pair representing identity signing and encryption private keys.
 * @param {Uint8Array} masterKeyBytes - The raw AES master key buffer.
 * @param {object} sodium - Libsodium sumo wrappers instance.
 * @returns {object} Ciphertext and nonce representing encrypted private keys.
 */
function encryptPrivateKeysV2 (privateKeys, masterKeyBytes, sodium) {
  const plaintext = JSON.stringify({
    private_box_key: privateKeys.private_box_key,
    private_sign_key: privateKeys.private_sign_key
  })
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, masterKeyBytes)
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Encrypt master key with KEK.
 * @param {Uint8Array} masterKeyBytes - The raw AES master key buffer.
 * @param {Uint8Array} KEK - The key encryption key buffer.
 * @param {object} sodium - Libsodium sumo wrappers instance.
 * @returns {object} Ciphertext and nonce representing encrypted master key wrap.
 */
function encryptMasterKeyWithKekV2 (masterKeyBytes, KEK, sodium) {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(masterKeyBytes, nonce, KEK)
  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  }
}

/**
 * Generate recovery wraps.
 * @param {Uint8Array} masterKeyBytes - The raw AES master key buffer.
 * @param {object} sodium - Libsodium sumo wrappers instance.
 * @returns {object} The encrypted recovery wraps and plaintext code strings.
 */
function generateRecoveryWrapsV2 (masterKeyBytes, sodium) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const part = () => Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => chars[b % chars.length])
    .join('')

  const code = `RC-${part()}-${part()}-${part()}-${part()}`
  const wraps = []

  const codeHash = sodium.crypto_generichash(32, code)
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(masterKeyBytes, nonce, codeHash)
  wraps.push({
    hash: sodium.to_base64(codeHash, sodium.base64_variants.ORIGINAL),
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL)
  })

  return {
    wraps,
    plaintextCodes: [code]
  }
}

/**
 * Resets Mock PocketBase and seeds Alice/Bob.
 * @param {string} testId - Test routing context identifier.
 * @returns {Promise<void>} Resolves when reset is complete.
 */
async function resetPocketBase (testId) {
  console.log(`--- Resetting and Seeding PocketBase for: ${testId} ---`)
  await sodium.ready
  const pb = new PocketBase('http://localhost:8091')

  pb.beforeSend = (url, options) => {
    const headers = options.headers || {}
    headers['x-test-id'] = testId
    options.headers = headers
    return {
      url,
      options
    }
  }

  const collections = ['messages', 'rooms', 'room_members', 'room_settings', 'room_member_states', 'media', 'invitations']
  for (const col of collections) {
    try {
      const records = await pb.collection(col).getFullList({ requestKey: null })
      for (const rec of records) {
        await pb.collection(col).delete(rec.id, { requestKey: null })
      }
    } catch {
      /* ignore */
    }
  }

  // Seed default invitation code
  try {
    await pb.collection('invitations').create({
      code: 'INV-SEED-1111',
      is_used: false,
      max_uses: 100,
      used_count: 0
    }, { requestKey: null })
  } catch {
    /* ignore */
  }

  const users = [
    {
      username: 'alice',
      tier: 'owner'
    },
    {
      username: 'bob',
      tier: 'standard'
    }
  ]

  for (const user of users) {
    try {
      const { keyA: keyABytes, keyB: passwordB } = await deriveAuthAndVaultKeys(user.username, 'Password123!', {
        opslimit: 1,
        memlimit: 8388608
      })

      const masterKeys = await generateMasterKeys(sodium)
      const salt = generateSalt(sodium)
      const masterKeyBytes = sodium.randombytes_buf(32)
      const passwordWrap = encryptMasterKeyWithKekV2(masterKeyBytes, keyABytes, sodium)
      const encryptedPrivateKeys = encryptPrivateKeysV2(masterKeys, masterKeyBytes, sodium)
      const { wraps: recoveryWraps } = generateRecoveryWrapsV2(masterKeyBytes, sodium)

      const pbUser = await pb.collection('users').create({
        username: user.username,
        name: user.username.charAt(0).toUpperCase() + user.username.slice(1),
        email: '',
        password: passwordB,
        passwordConfirm: passwordB,
        emailVisibility: false,
        public_box_key: masterKeys.public_box_key,
        public_sign_key: masterKeys.public_sign_key,
        vault_salt: sodium.to_base64(salt, sodium.base64_variants.ORIGINAL),
        encrypted_master_keys: passwordWrap,
        encrypted_private_keys: encryptedPrivateKeys,
        recovery_wraps: recoveryWraps,
        altcha: 'atoll-mock-bypass-token'
      }, { requestKey: null })

      await pb.collection('user_trust').create({
        user: pbUser.id,
        tier: user.tier,
        invite_quota: user.tier === 'owner' ? 9999 : 0,
        invites_revoked: false
      }, { requestKey: null })
    } catch (err) {
      console.error(`Failed to seed user ${user.username}:`, err.message)
    }
  }

  console.log('--- PocketBase Reset Complete ---')
}

/**
 * Start the benchmark servers.
 */
async function startServers () {
  if (process.env.ATOLL_SKIP_SERVERS) {
    console.log('--- Skipping server startup (ATOLL_SKIP_SERVERS is active) ---')
    console.log('--- Waiting for existing servers to be healthy ---')
    await waitForPort(8091)
    await waitForPort(3000)
    console.log('Servers are fully ready and healthy!')
    return
  }

  console.log('--- Cleaning previous build directory ---')
  execSync('rm -rf dist', { cwd: projectRoot })

  console.log('--- Compiling production bundle ---')
  execSync('pnpm run build', {
    env: {
      ...process.env,
      ATOLL_POCKETBASE_URL: 'http://localhost:8091'
    },
    stdio: 'inherit',
    cwd: projectRoot
  })

  console.log('--- Starting Mock PocketBase Server on port 8091 ---')
  const pbProc = spawn('node', ['tests/e2e/setup/mock-pb-server.js'], {
    env: {
      ...process.env,
      MOCK_PB_PORT: '8091'
    },
    cwd: projectRoot,
    stdio: 'ignore'
  })
  childProcesses.push(pbProc)

  console.log('--- Starting App Web Server on port 3000 ---')
  const appProc = spawn('pnpm', ['run', 'test:server'], {
    env: {
      ...process.env,
      ATOLL_POCKETBASE_URL: 'http://localhost:8091',
      ATOLL_INTERNAL_POCKETBASE_URL: 'http://localhost:8091',
      NODE_ENV: 'test'
    },
    cwd: projectRoot,
    stdio: 'ignore'
  })
  childProcesses.push(appProc)

  console.log('--- Waiting for servers to be healthy ---')
  await waitForPort(8091)
  await waitForPort(3000)
  console.log('Servers are fully ready and healthy!')
}

/**
 * Run the benchmarking suite.
 */
async function main () {
  // Start backend and frontend servers
  await startServers()

  // Reset/seed database for the benchmark test id
  const testId = 'perf_benchmark_test'
  await resetPocketBase(testId)

  // Derive keys and log in Alice on the Node side first
  await sodium.ready
  const pb = new PocketBase('http://localhost:8091')
  pb.beforeSend = (url, options) => {
    options.headers = options.headers || {}
    options.headers['x-test-id'] = testId
    return {
      url,
      options
    }
  }
  console.log('--- Performing programmatic login on Node side ---')
  const authData = await pb.collection('users').authWithPassword('alice', 'Password123!')
  console.log('Node programmatic login succeeded!')

  console.log('--- Launching headless browser with Playwright ---')
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-loopback-in-peer-connection',
      '--enforce-webrtc-ip-permission-check=false',
      '--unlimited-storage'
    ]
  })

  const context = await browser.newContext()

  // Mock sw.js to prevent background takeover, caching, and unexpected reloads
  await context.route(url => url.href.endsWith('/sw.js'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '// Dummy SW for testing\nself.addEventListener("install", () => self.skipWaiting());\nself.addEventListener("activate", () => self.clients.claim());'
    })
  })

  // Set up header injection for mock backend test routing
  await context.route(url => url.href.includes('/api/'), async (route) => {
    const request = route.request()
    if (request.url().includes('/realtime') && request.method() === 'GET') {
      await route.continue()
      return
    }

    const headers = {
      ...request.headers(),
      'x-test-id': testId
    }
    await route.continue({ headers })
  })

  // Inject window.Worker wrap to capture $cryptoWorker instance and override EventSource
  await context.addInitScript((tId) => {
    // Intercept and bypass controllerchange to prevent unexpected reload race conditions in tests
    if ('serviceWorker' in navigator) {
      const originalAddEventListener = navigator.serviceWorker.addEventListener
      navigator.serviceWorker.addEventListener = function (type, listener, options) {
        if (type === 'controllerchange') {
          console.log('[E2E Mock] Bypassing controllerchange event listener to prevent unexpected reload')
          return
        }
        return originalAddEventListener.call(this, type, listener, options)
      }
      Object.defineProperty(navigator.serviceWorker, 'oncontrollerchange', {
        set () {
          console.log('[E2E Mock] Bypassing oncontrollerchange setter to prevent unexpected reload')
        },
        get () {
          return null
        },
        configurable: true
      })

      // Mock navigator.serviceWorker.ready to resolve immediately to a mock registration
      const mockRegistration = Object.create(window.ServiceWorkerRegistration?.prototype || Object.prototype)
      Object.defineProperty(navigator.serviceWorker, 'ready', {
        get () {
          return Promise.resolve(mockRegistration)
        },
        configurable: true
      })
    }

    window.__playwright_test_id__ = tId
    window.OriginalWorker = window.Worker
    window.Worker = function (url, options) {
      const isCryptoWorker = url && url.includes('worker.js') && !url.includes('media-worker.js')
      console.log('[DIAGNOSTIC] Instantiating Worker:', url, 'Is Crypto:', isCryptoWorker)
      const worker = new window.OriginalWorker(url, options)
      if (isCryptoWorker) {
        console.log('[DIAGNOSTIC] Captured active $cryptoWorker instance!')
        window.$cryptoWorker = worker

        // Attach listeners to spy on traffic
        worker.addEventListener('message', (e) => {
          console.log('[DIAGNOSTIC WORKER OUT]:', e.data.type, e.data.id, !!e.data.error)
        })

        const originalPost = worker.postMessage
        worker.postMessage = function (msg, trans) {
          console.log('[DIAGNOSTIC WORKER IN]:', msg.type, msg.id)
          return originalPost.call(this, msg, trans)
        }
      }
      return worker
    }
    window.Worker.prototype = window.OriginalWorker.prototype

    const OriginalEventSource = window.EventSource
    window.EventSource = class extends OriginalEventSource {
      constructor (url, eventSourceInitDict) {
        if (url && (url.includes('/api/realtime') || url.includes('/api/')) && !url.includes('x-test-id=')) {
          const separator = url.includes('?') ? '&' : '?'
          url = `${url}${separator}x-test-id=${tId}`
        }
        super(url, eventSourceInitDict)
      }
    }

    // Global uncaught rejection logger
    window.addEventListener('unhandledrejection', event => {
      console.error('Unhandled rejection:', event.reason?.message || event.reason)
    })
  }, testId)

  const page = await context.newPage()

  // Register Console event logging inside browser for debugging
  page.on('console', msg => {
    console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`)
  })
  page.on('pageerror', err => {
    console.log(`[BROWSER ERROR] ${err.message}`)
  })
  page.on('request', req => {
    console.log(`[BROWSER REQUEST] ${req.method()} ${req.url()}`)
  })
  page.on('requestfailed', req => {
    console.log(`[BROWSER REQUEST FAILED] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`)
  })
  page.on('response', res => {
    if (res.status() >= 400) {
      console.log(`[BROWSER RESPONSE ERROR] ${res.status()} ${res.url()}`)
    }
  })

  // Set the token inside localStorage by navigating to '/' first
  console.log('--- Priming localStorage with Alice session token ---')
  await page.goto('http://localhost:3000')
  await page.evaluate(({ token, record }) => {
    window.localStorage.setItem('pocketbase_auth', JSON.stringify({
      token,
      model: record
    }))
  }, {
    token: authData.token,
    record: authData.record
  })

  // Reload the page with the token already populated!
  console.log('--- Reloading to resume session and trigger vault unlock ---')
  await page.goto('http://localhost:3000')
  await page.waitForFunction(() => window.__coralite__ && window.__coralite__.lifecycle !== undefined)
  await page.evaluate(() => window.__coralite__.lifecycle.hydrated)
  console.log('Page hydrated with resumed session!')

  // The page will now instantly display the vault-unlock screen
  console.log('Waiting for vault unlock screen to be ready...')
  const vaultPasswordInput = page.locator('vault-unlock input[data-testid$="password"]')
  await vaultPasswordInput.waitFor({
    state: 'visible',
    timeout: 5000
  })

  console.log('Entering vault password...')
  await vaultPasswordInput.click()
  await vaultPasswordInput.pressSequentially('Password123!', { delay: 10 })

  // Trigger unlock click programmatically on both the inner button and form
  console.log('Submitting vault unlock form programmatically...')
  await page.evaluate(() => {
    const innerBtn = document.querySelector('vault-unlock atoll-button[data-testid="unlockSubmit"] button')
    if (innerBtn) {
      innerBtn.click()
    } else {
      const form = document.querySelector('vault-unlock form')
      if (form) {
        const event = new Event('submit', {
          cancelable: true,
          bubbles: true
        })
        form.dispatchEvent(event)
      }
    }
  })

  await page.waitForSelector('app-layout', { timeout: 15000 })
  console.log('Alice session hydrated completely!')

  // Inject window.__perf helpers
  console.log('--- Injecting performance benchmark helpers into browser ---')
  await page.evaluate(() => {
    window.__perf = {
      // Execute RPC on captured crypto worker
      execute: (type, payload) => {
        return new Promise((resolve, reject) => {
          console.log('[PERF EXECUTE] Calling worker task:', type, !!window.$cryptoWorker)
          if (!window.$cryptoWorker) {
            reject(new Error('Crypto worker not captured yet'))
            return
          }
          const id = crypto.randomUUID()
          const handler = (e) => {
            console.log('[PERF EXECUTE] Received worker message:', e.data.type, e.data.id === id)
            if (e.data.id === id) {
              window.$cryptoWorker.removeEventListener('message', handler)
              if (e.data.error) {
                reject(new Error(e.data.error))
              } else {
                resolve(e.data.result || e.data.payload)
              }
            }
          }
          window.$cryptoWorker.addEventListener('message', handler)
          window.$cryptoWorker.postMessage({
            id,
            type,
            payload
          })
        })
      },

      key: null,
      nonce: null,
      ciphertext: null,
      fileBytes: null,
      fileCiphertext: null,
      govPublicKey: null,
      govPrivateKey: null,
      govCiphertext: null,

      async init () {
        console.log('[PERF HELPER] Initializing __perf state...')
        // Wait for worker setup to settle
        await new Promise(r => setTimeout(r, 2000))
        this.key = new Uint8Array(32)
        crypto.getRandomValues(this.key)
        this.nonce = new Uint8Array(24)
        crypto.getRandomValues(this.nonce)

        console.log('[PERF HELPER] Warmup msg encrypt...')
        // Warmup msg encrypt
        this.ciphertext = await this.execute('worker:crypto_secretbox_easy', {
          message: 'Hello World',
          nonce: this.nonce,
          key: this.key
        })

        console.log('[PERF HELPER] Warmup 1MB file...')
        // Warmup 1MB file bytes (generating in chunks to prevent QuotaExceededError)
        this.fileBytes = new Uint8Array(1024 * 1024)
        for (let i = 0; i < this.fileBytes.length; i += 65536) {
          const chunk = this.fileBytes.subarray(i, i + 65536)
          crypto.getRandomValues(chunk)
        }

        this.fileCiphertext = await this.execute('worker:crypto_secretbox_easy', {
          message: this.fileBytes,
          nonce: this.nonce,
          key: this.key
        })

        console.log('[PERF HELPER] Warmup Gov keys...')
        // Warmup Gov keys
        const masterKeys = await this.execute('worker:generate_master_keys', {})
        this.govPublicKey = masterKeys.public_box_key
        this.govPrivateKey = masterKeys.private_box_key
        this.govCiphertext = await this.execute('worker:crypto_box_seal', {
          message: 'Secret Governance Info',
          publicKey: this.govPublicKey
        })
        console.log('[PERF HELPER] State successfully initialized!')
      },

      async benchMsgEncrypt () {
        return this.execute('worker:crypto_secretbox_easy', {
          message: 'Hello Performance Benchmark',
          nonce: this.nonce,
          key: this.key
        })
      },

      async benchMsgDecrypt () {
        return this.execute('worker:crypto_secretbox_open_easy', {
          ciphertext: this.ciphertext,
          nonce: this.nonce,
          key: this.key
        })
      },

      async benchGovSeal () {
        return this.execute('worker:crypto_box_seal', {
          message: 'Secret Governance Info',
          publicKey: this.govPublicKey
        })
      },

      async benchGovSealOpen () {
        return this.execute('worker:crypto_box_seal_open', {
          ciphertext: this.govCiphertext,
          publicKey: this.govPublicKey,
          privateKey: this.govPrivateKey
        })
      },

      async benchFileEncrypt () {
        return this.execute('worker:crypto_secretbox_easy', {
          message: this.fileBytes,
          nonce: this.nonce,
          key: this.key
        })
      },

      async benchFileDecrypt () {
        return this.execute('worker:decrypt_file', {
          encryptedBuffer: this.fileCiphertext,
          nonce: this.nonce,
          key: this.key
        })
      },

      async benchDbWrite () {
        const roomId = 'perf_db_room'
        const messages = []
        for (let i = 0; i < 500; i++) {
          messages.push({
            local_uuid: `perf_db_msg_${i}`,
            id: `perf_db_msg_${i}`,
            room_id: roomId,
            created_at: new Date(Date.now() - (i * 1000)).toISOString(),
            sender_id: 'alice',
            type: 'text',
            content: `Perf message ${i}`,
            status: 'sent'
          })
        }
        const start = performance.now()
        await window.$localDb.local_messages.bulkPut(messages)
        const duration = performance.now() - start
        await window.$localDb.local_messages.where('room_id').equals(roomId).delete()
        return duration
      },

      async benchDbQuery () {
        const roomId = 'perf_db_query_room'
        const messages = []
        for (let i = 0; i < 200; i++) {
          messages.push({
            local_uuid: `perf_query_msg_${i}`,
            id: `perf_query_msg_${i}`,
            room_id: roomId,
            created_at: new Date(Date.now() - (i * 1000)).toISOString(),
            sender_id: 'alice',
            type: 'text',
            content: `Perf message ${i}`,
            status: 'sent'
          })
        }
        await window.$localDb.local_messages.bulkPut(messages)

        const start = performance.now()
        await window.$localDb.local_messages
          .where('[room_id+created_at]')
          .between([roomId, ''], [roomId, '\uffff'])
          .reverse()
          .limit(200)
          .toArray()
        const duration = performance.now() - start
        await window.$localDb.local_messages.where('room_id').equals(roomId).delete()
        return duration
      },

      async benchTimelineRender (msgCount) {
        const roomId = `perf_room_${msgCount}`
        const roomExists = await window.$localDb.local_rooms.get(roomId)
        if (!roomExists) {
          await window.$localDb.local_rooms.put({
            id: roomId,
            name: `Perf ${msgCount} Room`,
            is_group: false,
            updated_at: new Date().toISOString(),
            participants: [
              {
                id: 'alice',
                name: 'Alice',
                username: 'alice'
              },
              {
                id: 'bob',
                name: 'Bob',
                username: 'bob'
              }
            ]
          })
          const messages = []
          for (let i = 0; i < msgCount; i++) {
            messages.push({
              local_uuid: `perf_msg_${roomId}_${i}`,
              id: `perf_msg_${roomId}_${i}`,
              room_id: roomId,
              created_at: new Date(Date.now() - ((msgCount - i) * 1000)).toISOString(),
              sender_id: 'alice',
              type: 'text',
              content: `Test message ${i}`,
              status: 'sent'
            })
          }
          await window.$localDb.local_messages.bulkPut(messages)
        }

        const start = performance.now()
        window.$bus.emit('room:select', { room_id: roomId })

        await new Promise((resolve) => {
          const check = () => {
            const rows = document.querySelectorAll('atoll-chat-timeline-row')
            if (rows.length >= msgCount) {
              resolve()
            } else {
              setTimeout(check, 10)
            }
          }
          check()
        })

        const duration = performance.now() - start
        window.$bus.emit('room:select', { room_id: null })
        await new Promise(r => setTimeout(r, 100))
        return duration
      },

      async benchTimelineScrollJank () {
        const roomId = 'perf_room_500'
        window.$bus.emit('room:select', { room_id: roomId })
        await new Promise((resolve) => {
          const check = () => {
            const rows = document.querySelectorAll('atoll-chat-timeline-row')
            if (rows.length >= 500) {
              resolve()
            } else {
              setTimeout(check, 10)
            }
          }
          check()
        })

        const container = document.querySelector('atoll-chat-timeline .overflow-auto')
        if (!container) {
          return {
            fps: 60,
            jankCount: 0
          }
        }

        const frameGaps = []
        let lastTime = performance.now()
        let isScrolling = true

        const sampleFrames = (now) => {
          const gap = now - lastTime
          frameGaps.push(gap)
          lastTime = now
          if (isScrolling) {
            requestAnimationFrame(sampleFrames)
          }
        }
        requestAnimationFrame(sampleFrames)

        const step = 50
        const delay = 16
        for (let current = container.scrollHeight; current > 0; current -= step) {
          container.scrollTop = current
          await new Promise(r => setTimeout(r, delay))
        }

        isScrolling = false
        await new Promise(r => setTimeout(r, 100))

        const totalDuration = frameGaps.reduce((a, b) => a + b, 0)
        const fps = (frameGaps.length / totalDuration) * 1000
        const jankCount = frameGaps.filter(g => g > 25).length

        window.$bus.emit('room:select', { room_id: null })
        return {
          fps,
          jankCount
        }
      },

      async benchServerHook (endpoint) {
        const authRaw = window.localStorage.getItem('pocketbase_auth')
        const token = authRaw ? JSON.parse(authRaw).token : ''
        const start = performance.now()
        await window.fetch(`http://localhost:8091${endpoint}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-test-id': window.__playwright_test_id__ || 'default'
          }
        })
        return performance.now() - start
      }
    }
  })

  // Initialize helper states (pre-generate keys/bytes)
  await page.evaluate(() => window.__perf.init())

  // Define metric dictionary to harvest results
  const harvestedStats = {}

  console.log('\n--- Starting mitata Benchmark Suite ---')

  group('Cryptographic performance (P0)', () => {
    bench('Msg encrypt throughput', async () => {
      await page.evaluate(() => window.__perf.benchMsgEncrypt())
    })
    bench('Msg decrypt throughput', async () => {
      await page.evaluate(() => window.__perf.benchMsgDecrypt())
    })
    bench('Governance box seal', async () => {
      await page.evaluate(() => window.__perf.benchGovSeal())
    })
    bench('Governance box seal_open', async () => {
      await page.evaluate(() => window.__perf.benchGovSealOpen())
    })
    bench('File encrypt (1MB) throughput', async () => {
      await page.evaluate(() => window.__perf.benchFileEncrypt())
    })
    bench('File decrypt (1MB) throughput', async () => {
      await page.evaluate(() => window.__perf.benchFileDecrypt())
    })
  })

  group('Database & persistence performance (P1)', () => {
    bench('Dexie write throughput (500 messages)', async () => {
      await page.evaluate(() => window.__perf.benchDbWrite())
    })
    bench('Dexie query latency (200 messages)', async () => {
      await page.evaluate(() => window.__perf.benchDbQuery())
    })
  })

  group('Server hooks & governance (P1)', () => {
    bench('Admin overview latency (/api/custom/admin/overview)', async () => {
      await page.evaluate(() => window.__perf.benchServerHook('/api/custom/admin/overview'))
    })
    bench('Owner public key latency (/api/custom/owner/public-key)', async () => {
      await page.evaluate(() => window.__perf.benchServerHook('/api/custom/owner/public-key'))
    })
    bench('Invite generate latency (/api/custom/invites/generate)', async () => {
      await page.evaluate(() => window.__perf.benchServerHook('/api/custom/invites/generate'))
    })
  })

  // Execute Mitata suite
  const mitataResult = await run({ format: 'mitata' })

  // Map mitata runs to harvestedStats
  for (const b of mitataResult.benchmarks) {
    const runStats = b.runs[0]?.stats
    if (runStats) {
      // Convert nanoseconds to milliseconds
      harvestedStats[b.alias || b.name] = {
        avg: runStats.avg / 1000000,
        p50: runStats.p50 / 1000000,
        p95: runStats.p99 / 1000000
      }
    }
  }

  // Measure custom UI/scrolling/startup metrics
  console.log('\n--- Measuring UI & Scrolling Performance ---')

  const t100 = await page.evaluate(() => window.__perf.benchTimelineRender(100))
  const t500 = await page.evaluate(() => window.__perf.benchTimelineRender(500))
  const t2000 = await page.evaluate(() => window.__perf.benchTimelineRender(2000))
  const scrollResults = await page.evaluate(() => window.__perf.benchTimelineScrollJank())

  harvestedStats['Timeline Render (100 messages)'] = {
    avg: t100,
    p50: t100,
    p95: t100
  }
  harvestedStats['Timeline Render (500 messages)'] = {
    avg: t500,
    p50: t500,
    p95: t500
  }
  harvestedStats['Timeline Render (2000 messages)'] = {
    avg: t2000,
    p50: t2000,
    p95: t2000
  }
  harvestedStats['Timeline Scroll FPS'] = {
    avg: scrollResults.fps,
    p50: scrollResults.fps,
    p95: scrollResults.fps
  }
  harvestedStats['Timeline Scroll Jank Count'] = {
    avg: scrollResults.jankCount,
    p50: scrollResults.jankCount,
    p95: scrollResults.jankCount
  }

  console.log('UI/Scrolling measurements complete!')

  // Clean up browser
  await browser.close()

  // Define Baseline Performance Threshold Limits
  const baselineLimits = {
    'Msg encrypt throughput': {
      p50: 15,
      msg: 'Message encryption is too slow'
    },
    'Msg decrypt throughput': {
      p50: 15,
      msg: 'Message decryption is too slow'
    },
    'Governance box seal': {
      p50: 20,
      msg: 'Governance box sealing is too slow'
    },
    'Governance box seal_open': {
      p50: 20,
      msg: 'Governance box seal-opening is too slow'
    },
    'File encrypt (1MB) throughput': {
      p50: 100,
      msg: '1MB File encryption is too slow'
    },
    'File decrypt (1MB) throughput': {
      p50: 100,
      msg: '1MB File decryption is too slow'
    },
    'Dexie write throughput (500 messages)': {
      p50: 300,
      msg: 'IndexedDB bulk messages write is too slow'
    },
    'Dexie query latency (200 messages)': {
      p50: 200,
      msg: 'IndexedDB room messages query is too slow'
    },
    'Admin overview latency (/api/custom/admin/overview)': {
      p50: 150,
      msg: 'Admin overview REST API is too slow'
    },
    'Timeline Render (500 messages)': {
      p50: 3000,
      msg: 'Timeline 500 messages rendering is too slow'
    },
    'Timeline Scroll FPS': {
      min_p50: 30,
      msg: 'Timeline scrolling FPS is too low'
    }
  }

  // Output formatted report
  const timestamp = new Date().toISOString()
  let mdReport = `# Atoll Chat Performance Benchmark Report 🏝️\n\nGenerated on: \`${timestamp}\`\n\n`
  mdReport += '| Metric Name | Avg Latency (ms) | p50 (ms) | p95 (ms) | Baseline Target (ms) | Status |\n'
  mdReport += '| :--- | :---: | :---: | :---: | :---: | :---: |\n'

  let hasRegression = false
  const regressionErrors = []

  for (const [metric, stats] of Object.entries(harvestedStats)) {
    const limit = baselineLimits[metric]
    let status = '✅ PASS'
    let targetStr = '-'

    if (limit) {
      if (limit.p50) {
        targetStr = `< ${limit.p50}ms`
        if (stats.p50 > limit.p50) {
          status = '❌ FAIL (REGRESSION)'
          hasRegression = true
          regressionErrors.push(`${limit.msg}: Actual p50 was ${stats.p50.toFixed(2)}ms (Target ${targetStr})`)
        }
      } else if (limit.min_p50) {
        targetStr = `> ${limit.min_p50}`
        if (stats.p50 < limit.min_p50) {
          status = '❌ FAIL (REGRESSION)'
          hasRegression = true
          regressionErrors.push(`${limit.msg}: Actual FPS was ${stats.p50.toFixed(2)} (Target ${targetStr})`)
        }
      }
    }

    const formatVal = (v) => ((metric.includes('FPS') || metric.includes('Count')) ? v.toFixed(1) : `${v.toFixed(2)}ms`)
    mdReport += `| **${metric}** | ${formatVal(stats.avg)} | ${formatVal(stats.p50)} | ${formatVal(stats.p95)} | ${targetStr} | **${status}** |\n`
  }

  // Write reports to disk
  fs.writeFileSync(resultsMdPath, mdReport, 'utf-8')
  fs.writeFileSync(resultsJsonPath, JSON.stringify({
    timestamp,
    results: harvestedStats
  }, null, 2), 'utf-8')

  console.log(`\n--- Benchmark reports successfully generated ---`)
  console.log(`Markdown Report: ${resultsMdPath}`)
  console.log(`JSON Report: ${resultsJsonPath}`)

  if (hasRegression) {
    console.error('\n❌ PERFORMANCE REGRESSION(S) DETECTED:')
    for (const err of regressionErrors) {
      console.error(`  - ${err}`)
    }
    process.exit(1)
  } else {
    console.log('\n✅ All performance benchmarks are within healthy parameters!')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Benchmark suite execution failed:', err)
  process.exit(1)
})
