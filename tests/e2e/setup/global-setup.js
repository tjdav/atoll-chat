import { execSync } from 'child_process'
import { createServer } from './mock-pb-server.js'

/**
 * Check if the coturn docker container is running.
 * @returns {boolean} True if the coturn container is running.
 */
function isCoturnContainerRunning () {
  const inspectCommands = [
    'docker inspect -f "{{.State.Running}}" atoll-coturn',
    'sudo docker inspect -f "{{.State.Running}}" atoll-coturn'
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
    'docker compose up -d coturn',
    'docker-compose up -d coturn',
    'sudo docker compose up -d coturn',
    'sudo docker-compose up -d coturn'
  ]

  let lastError = null
  for (const cmd of commands) {
    try {
      console.log(`Attempting coturn start with: ${cmd}`)
      execSync(cmd, { stdio: 'inherit' })
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
  console.log('--- Mock PocketBase Setup ---')
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.listen(8090, '127.0.0.1', (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
  console.log('Mock PocketBase server is running on http://127.0.0.1:8090')
  globalThis.__MOCK_PB_SERVER__ = server

  console.log('--- Coturn STUN/TURN Server Setup ---')
  globalThis.__COTURN_CONTAINER_USED__ = false
  globalThis.__NATIVE_TURNSERVER_STARTED__ = false

  if (isCoturnContainerRunning()) {
    console.log('Coturn docker container is already running. Using it.')
    globalThis.__COTURN_CONTAINER_USED__ = true
    return
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
        execSync('sudo killall turnserver || true', { stdio: 'inherit' })
        execSync('sudo /usr/bin/turnserver -n --log-file=/tmp/turnserver.log --listening-port=3478 --lt-cred-mech --user=testuser:testpass --realm=atoll-chat > /tmp/turnserver-start.log 2>&1 &')
        console.log('Successfully started native turnserver daemon in background!')
        globalThis.__NATIVE_TURNSERVER_STARTED__ = true
      } catch (nativeErr) {
        console.error('Failed to start native turnserver daemon:', nativeErr)
      }
    }
  }
}

export default globalSetup
