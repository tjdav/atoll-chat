import { execSync } from 'child_process'

/**
 * Attempt to stop coturn using direct docker commands or docker compose commands.
 */
function runDockerComposeStop () {
  const stopCommands = [
    'docker stop atoll-coturn',
    'sudo docker stop atoll-coturn'
  ]
  for (const cmd of stopCommands) {
    try {
      execSync(cmd, { stdio: 'pipe' })
      console.log(`Successfully stopped coturn container using: ${cmd}`)
      return
    } catch {
      /* ignore and try next or compose */
    }
  }

  const commands = [
    'docker compose -f tests/e2e/setup/docker-compose.yml stop coturn',
    'docker-compose -f tests/e2e/setup/docker-compose.yml stop coturn',
    'sudo docker compose -f tests/e2e/setup/docker-compose.yml stop coturn',
    'sudo docker-compose -f tests/e2e/setup/docker-compose.yml stop coturn'
  ]

  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'pipe' })
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
    if (typeof globalThis.__MOCK_PB_SERVER__.closeAllConnections === 'function') {
      globalThis.__MOCK_PB_SERVER__.closeAllConnections()
    }
    await new Promise((resolve) => {
      globalThis.__MOCK_PB_SERVER__.close(() => {
        resolve()
      })
      setTimeout(resolve, 1000)
    })
    console.log('Mock PocketBase server stopped.')
  } else {
    console.log('No active Mock PocketBase server found to teardown.')
  }

  console.log('--- Coturn STUN/TURN Server Teardown ---')
  if (globalThis.__COTURN_CONTAINER_USED__) {
    try {
      runDockerComposeStop()
    } catch (err) {
      console.error('Failed to stop coturn service via docker compose:', err)
    }
  } else {
    console.log('Coturn container was not used. Skipping docker compose stop.')
  }

  if (globalThis.__NATIVE_TURNSERVER_STARTED__) {
    try {
      console.log('Attempting to stop native turnserver daemon...')
      execSync('sudo killall turnserver || true', { stdio: 'pipe' })
    } catch (err) {
      console.error('Failed to kill native turnserver daemon:', err)
    }
  } else {
    console.log('Native turnserver daemon was not started by this test run. Skipping stop.')
  }
}

export default globalTeardown
