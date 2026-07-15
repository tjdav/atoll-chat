import { execSync } from 'child_process'
import { createServer } from './mock-pb-server.js'

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
  try {
    runDockerComposeUp()
  } catch (err) {
    console.error('Failed to start coturn service via docker compose, attempting native turnserver daemon start...', err)
    try {
      execSync('sudo killall turnserver || true', { stdio: 'inherit' })
      execSync('sudo /usr/bin/turnserver -n --log-file=/tmp/turnserver.log --listening-port=3478 --lt-cred-mech --user=testuser:testpass --realm=atoll-chat > /tmp/turnserver-start.log 2>&1 &')
      console.log('Successfully started native turnserver daemon in background!')
    } catch (nativeErr) {
      console.error('Failed to start native turnserver daemon:', nativeErr)
    }
  }
}

export default globalSetup
