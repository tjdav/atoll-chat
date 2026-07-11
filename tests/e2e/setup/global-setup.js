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
    console.error('Failed to start coturn service via docker compose:', err)
  }
}

export default globalSetup
