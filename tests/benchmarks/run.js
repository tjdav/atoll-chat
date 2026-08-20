import { spawn, execSync } from 'child_process'
import { chromium } from '@playwright/test'
import { run, bench, group } from 'mitata'
import fs, { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import pbPath from 'path'
import PocketBase from 'pocketbase'
import sodium from 'libsodium-wrappers-sumo'
import net from 'net'
import { deriveAuthAndVaultKeys } from '../../src/utils/keys.js'

// Import modular benchmark suites
import * as cryptoSuite from './suites/crypto.js'
import * as databaseSuite from './suites/database.js'
import * as serverSuite from './suites/server.js'
import * as uiSuite from './suites/ui.js'

const __dirname = pbPath.dirname(fileURLToPath(import.meta.url))
const projectRoot = pbPath.resolve(__dirname, '../..')

// Setup paths
const resultsMdPath = pbPath.join(projectRoot, 'docs/benchmark-results.md')
const resultsJsonPath = pbPath.join(projectRoot, 'docs/benchmark-results.json')

// Get custom executable path if exists
const getExecutablePath = (p) => (existsSync(p) ? p : undefined)
const executablePath = getExecutablePath('/usr/bin/google-chrome') || getExecutablePath('/usr/bin/chromium')

// Environment configuration for verbose logging
const isVerbose = process.env.VERBOSE === 'true' || process.env.DEBUG === 'true'

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
  const authProofBytes = sodium.crypto_hash_sha256(sodium.from_string('atoll-recovery-auth:' + code))
  const authProof = sodium.to_base64(authProofBytes, sodium.base64_variants.ORIGINAL)
  const verifierBytes = sodium.crypto_hash_sha256(sodium.from_string('atoll-recovery-verifier:' + authProof))
  const verifier = sodium.to_base64(verifierBytes, sodium.base64_variants.ORIGINAL)

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(masterKeyBytes, nonce, codeHash)
  wraps.push({
    verifier,
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
  // Wait for libsodium sumo wrappers to be ready
  await sodium.ready

  // Start backend and frontend servers
  await startServers()

  // Reset/seed database for the benchmark test id
  const testId = 'perf_benchmark_test'
  await resetPocketBase(testId)

  // Derive keys and log in Alice on the Node side first
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
  await context.addInitScript(({ tId, verbose }) => {
    // Intercept and bypass controllerchange to prevent unexpected reload race conditions in tests
    if ('serviceWorker' in navigator) {
      const originalAddEventListener = navigator.serviceWorker.addEventListener
      navigator.serviceWorker.addEventListener = function (type, listener, options) {
        if (type === 'controllerchange') {
          if (verbose) {
            console.log('[E2E Mock] Bypassing controllerchange event listener to prevent unexpected reload')
          }
          return
        }
        return originalAddEventListener.call(this, type, listener, options)
      }
      Object.defineProperty(navigator.serviceWorker, 'oncontrollerchange', {
        set () {
          if (verbose) {
            console.log('[E2E Mock] Bypassing oncontrollerchange setter to prevent unexpected reload')
          }
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
      if (verbose) {
        console.log('[DIAGNOSTIC] Instantiating Worker:', url, 'Is Crypto:', isCryptoWorker)
      }
      const worker = new window.OriginalWorker(url, options)
      if (isCryptoWorker) {
        if (verbose) {
          console.log('[DIAGNOSTIC] Captured active $cryptoWorker instance!')
        }
        window.$cryptoWorker = worker

        // Attach listeners to spy on traffic
        worker.addEventListener('message', (e) => {
          if (verbose) {
            console.log('[DIAGNOSTIC WORKER OUT]:', e.data.type, e.data.id, !!e.data.error)
          }
        })

        const originalPost = worker.postMessage
        worker.postMessage = function (msg, trans) {
          if (verbose) {
            console.log('[DIAGNOSTIC WORKER IN]:', msg.type, msg.id)
          }
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
  }, {
    tId: testId,
    verbose: isVerbose
  })

  const page = await context.newPage()

  // Register Console event logging inside browser (suppressed unless verbose is enabled)
  page.on('console', msg => {
    if (isVerbose) {
      console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`)
    }
  })
  page.on('pageerror', err => {
    console.log(`[BROWSER ERROR] ${err.message}`)
  })
  page.on('request', req => {
    if (isVerbose) {
      console.log(`[BROWSER REQUEST] ${req.method()} ${req.url()}`)
    }
  })
  page.on('requestfailed', req => {
    if (isVerbose) {
      console.log(`[BROWSER REQUEST FAILED] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`)
    }
  })
  page.on('response', res => {
    if (isVerbose) {
      if (res.status() >= 400) {
        console.log(`[BROWSER RESPONSE ERROR] ${res.status()} ${res.url()}`)
      } else {
        console.log(`[BROWSER RESPONSE] ${res.status()} ${res.url()}`)
      }
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

  // Inject general RPC execution capability
  await page.evaluate(() => {
    window.__perf = {
      execute: (type, payload) => {
        return new Promise((resolve, reject) => {
          if (!window.$cryptoWorker) {
            reject(new Error('Crypto worker not captured yet'))
            return
          }
          const id = crypto.randomUUID()
          const handler = (e) => {
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
      }
    }
  })

  // List of suites
  const suites = [
    {
      name: 'crypto',
      module: cryptoSuite
    },
    {
      name: 'database',
      module: databaseSuite
    },
    {
      name: 'server',
      module: serverSuite
    },
    {
      name: 'ui',
      module: uiSuite
    }
  ]

  // Generate Node-side cryptographic params for the browser context
  const keypair = sodium.crypto_box_keypair()
  const cryptoParams = {
    govPublicKey: sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL),
    govPrivateKey: sodium.to_base64(keypair.privateKey, sodium.base64_variants.ORIGINAL),
    fileKey: sodium.to_base64(sodium.randombytes_buf(32), sodium.base64_variants.ORIGINAL),
    fileNonce: sodium.to_base64(sodium.randombytes_buf(24), sodium.base64_variants.ORIGINAL)
  }

  // Phase 1: Inject helper functions into the browser context
  console.log('--- Injecting modular benchmark helpers into browser ---')
  for (const suite of suites) {
    if (suite.name === 'crypto') {
      await suite.module.inject(page, cryptoParams)
    } else {
      await suite.module.inject(page)
    }
  }

  // Phase 2: Register mitata benchmarks
  console.log('\n--- Registering mitata Benchmark Suites ---')
  for (const suite of suites) {
    suite.module.register(page, group, bench)
  }

  // Phase 3: Run Mitata Benchmark Suite
  console.log('\n--- Starting mitata Benchmark Suite ---')
  const mitataResult = await run({ format: 'mitata' })

  // Define metric dictionary to harvest results
  const harvestedStats = {}

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

  // Phase 4: Measure custom non-Mitata suite metrics
  console.log('\n--- Measuring Custom & UI Performance Metrics ---')
  for (const suite of suites) {
    const customResults = await suite.module.runCustom(page)
    Object.assign(harvestedStats, customResults)
  }
  console.log('UI/Scrolling measurements complete!')

  // Clean up browser
  await browser.close()

  // Collect consolidated baseline thresholds and limits from all modular suites
  const baselineLimits = {}
  for (const suite of suites) {
    Object.assign(baselineLimits, suite.module.baselineLimits)
  }

  // Output formatted report
  const timestamp = new Date().toISOString()
  let mdReport = `# Atoll Chat Performance Benchmark Report 🏝️\n\nGenerated on: \`${timestamp}\`\n\n`
  mdReport += '| Metric Name | Avg Latency (ms) | p50 (ms) | p95 (ms) | Baseline Target (ms) | Status |\n'
  mdReport += '| :--- | :---: | :---: | :---: | :---: | :---: |\n'

  let hasRegression = false
  const regressionErrors = []

  // Check scaling ratio regression (2000 vs 500 should be < 6.0x)
  const t500Stats = harvestedStats['Timeline Render (500 messages)']
  const t2000Stats = harvestedStats['Timeline Render (2000 messages)']
  if (t500Stats && t2000Stats) {
    const ratio = t2000Stats.p50 / t500Stats.p50
    const ratioStr = `Timeline Render Scaling Ratio (2000 / 500): ${ratio.toFixed(2)}x`
    console.log(`[PERFORMANCE DIAGNOSTIC] ${ratioStr}`)
    if (ratio > 6.0) {
      hasRegression = true
      regressionErrors.push(`Timeline Render scaling ratio was too high: ${ratio.toFixed(2)}x (Target < 6.0x)`)
    }
  }

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
