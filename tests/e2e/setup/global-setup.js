import { execSync } from 'child_process'
import { createServer } from './mock-pb-server.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const targetDir = path.join(__dirname, '../fixtures')
const targetPath = path.join(targetDir, 'test-video.y4m')

/**
 * Ensure the fake Y4M test video exists before any browser context boots.
 */
function ensureTestVideoExists () {
  if (fs.existsSync(targetPath)) {
    return
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const width = 128
  const height = 96
  const numFrames = 10

  const fileHeader = `YUV4MPEG2 W${width} H${height} F30:1 Ip C420jpeg\n`
  const frameHeader = 'FRAME\n'

  const ySize = width * height
  const uSize = (width / 2) * (height / 2)
  const vSize = (width / 2) * (height / 2)
  const frameDataSize = ySize + uSize + vSize

  const buffers = [Buffer.from(fileHeader, 'ascii')]

  for (let i = 0; i < numFrames; i++) {
    buffers.push(Buffer.from(frameHeader, 'ascii'))

    const frameBuffer = Buffer.alloc(frameDataSize)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = (((y * 2) + x) + (i * 4)) % 256
        frameBuffer[(y * width) + x] = val
      }
    }
    frameBuffer.fill(128, ySize, frameDataSize)
    buffers.push(frameBuffer)
  }

  fs.writeFileSync(targetPath, Buffer.concat(buffers))
  console.log(`Successfully generated fake Y4M video fixture at: ${targetPath}`)
}

/**
 * Check if the coturn docker container exists.
 * @returns {boolean} True if the coturn container exists.
 */
function doesCoturnContainerExist () {
  const inspectCommands = [
    'docker inspect atoll-coturn',
    'sudo -n docker inspect atoll-coturn'
  ]
  for (const cmd of inspectCommands) {
    try {
      execSync(cmd, { stdio: 'ignore' })
      return true
    } catch {
      /* ignore */
    }
  }
  return false
}

/**
 * Start the existing coturn docker container.
 * @returns {boolean} True if successfully started.
 */
function startCoturnContainer () {
  const startCommands = [
    'docker start atoll-coturn',
    'sudo -n docker start atoll-coturn'
  ]
  for (const cmd of startCommands) {
    try {
      execSync(cmd, { stdio: 'ignore' })
      return true
    } catch {
      /* ignore */
    }
  }
  return false
}

/**
 * Check if the coturn docker container is running.
 * @returns {boolean} True if the coturn container is running.
 */
function isCoturnContainerRunning () {
  const inspectCommands = [
    'docker inspect -f "{{.State.Running}}" atoll-coturn',
    'sudo -n docker inspect -f "{{.State.Running}}" atoll-coturn'
  ]
  for (const cmd of inspectCommands) {
    try {
      const stdout = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (stdout === 'true') {
        return true
      }
    } catch {
      /* ignore and check the next fallback command */
    }
  }
  return false
}

/**
 * Check if the native turnserver daemon is running.
 * @returns {boolean} True if the native turnserver is running.
 */
function isNativeTurnserverRunning () {
  try {
    execSync('pgrep -x turnserver', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Attempt to start coturn using different docker compose commands.
 */
function runDockerComposeUp () {
  const commands = [
    'docker compose -f tests/e2e/setup/docker-compose.yml up -d coturn',
    'docker-compose -f tests/e2e/setup/docker-compose.yml up -d coturn',
    'sudo -n docker compose -f tests/e2e/setup/docker-compose.yml up -d coturn',
    'sudo -n docker-compose -f tests/e2e/setup/docker-compose.yml up -d coturn'
  ]

  let lastError = null
  for (const cmd of commands) {
    try {
      console.log(`Attempting coturn start with: ${cmd}`)
      execSync(cmd, { stdio: 'pipe' })
      console.log(`Successfully started coturn service using: ${cmd}`)
      return
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`Failed to start coturn service. Last error: ${lastError?.message || lastError}`)
}

/**
 * Set up mock PocketBase and start local coturn STUN/TURN server.
 */
async function globalSetup () {
  console.log('--- Ensuring E2E Test Video Fixture ---')
  ensureTestVideoExists()

  console.log('--- Mock PocketBase Setup ---')
  const port = process.env.MOCK_PB_PORT || 8091
  const server = createServer()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', (err) => {
        try {
          server.close()
        } catch {
        }
        if (err.code === 'EADDRINUSE') {
          console.log(`Mock PocketBase server is already running on http://127.0.0.1:${port}`)
          resolve()
        } else {
          reject(err)
        }
      })
      server.listen(port, '127.0.0.1', () => {
        console.log(`Mock PocketBase server is running on http://127.0.0.1:${port}`)
        globalThis.__MOCK_PB_SERVER__ = server
        resolve()
      })
    })
  } catch (err) {
    console.warn('Mock PB setup warning:', err.message)
  }

  console.log('--- Coturn STUN/TURN Server Setup ---')
  globalThis.__COTURN_CONTAINER_USED__ = false
  globalThis.__NATIVE_TURNSERVER_STARTED__ = false

  if (isCoturnContainerRunning()) {
    console.log('Coturn docker container is already running. Using it.')
    globalThis.__COTURN_CONTAINER_USED__ = true
    return
  }

  if (doesCoturnContainerExist()) {
    console.log('Coturn docker container exists but is not running. Starting it directly...')
    if (startCoturnContainer()) {
      console.log('Successfully started existing coturn docker container directly.')
      globalThis.__COTURN_CONTAINER_USED__ = true
      return
    }
  }

  try {
    runDockerComposeUp()
    globalThis.__COTURN_CONTAINER_USED__ = true
  } catch (err) {
    console.error('Failed to start coturn service via docker compose, attempting native turnserver daemon start...', err)
    if (isNativeTurnserverRunning()) {
      console.log('Native turnserver daemon is already running. Reusing it.')
    } else {
      try {
        execSync('sudo -n killall turnserver || true', { stdio: 'pipe' })
        execSync('sudo -n /usr/bin/turnserver -n --log-file=/tmp/turnserver.log --listening-port=3478 --lt-cred-mech --user=testuser:testpass --realm=atoll-chat > /tmp/turnserver-start.log 2>&1 &')
        console.log('Successfully started native turnserver daemon in background!')
        globalThis.__NATIVE_TURNSERVER_STARTED__ = true
      } catch (nativeErr) {
        console.error('Failed to start native turnserver daemon:', nativeErr)
      }
    }
  }
}

export default globalSetup
