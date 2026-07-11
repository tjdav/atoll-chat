import { execSync } from 'child_process'

/**
 * Attempt to stop coturn using different docker compose commands.
 */
function runDockerComposeStop () {
  const commands = [
    'docker compose stop coturn',
    'docker-compose stop coturn',
    'sudo docker compose stop coturn',
    'sudo docker-compose stop coturn'
  ]

  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'inherit' })
      console.log(`Successfully stopped coturn service using: ${cmd}`)
      return
    } catch {
      // Keep trying next fallback command
    }
  }
}

/**
 * Teardown mock PocketBase and stop local coturn STUN/TURN server.
 */
async function globalTeardown () {
  console.log('--- Mock PocketBase Teardown ---')
  if (globalThis.__MOCK_PB_SERVER__) {
    await new Promise((resolve) => {
      globalThis.__MOCK_PB_SERVER__.close(() => {
        resolve()
      })
    })
    console.log('Mock PocketBase server stopped.')
  } else {
    console.log('No active Mock PocketBase server found to teardown.')
  }

  console.log('--- Coturn STUN/TURN Server Teardown ---')
  try {
    runDockerComposeStop()
  } catch (err) {
    console.error('Failed to stop coturn service via docker compose:', err)
  }
}

export default globalTeardown
