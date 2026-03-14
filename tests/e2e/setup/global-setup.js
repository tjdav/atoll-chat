import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function globalSetup () {
  console.log('Starting Conduit local server via Docker Compose...')
  try {
    await execAsync('docker compose up -d')
    console.log('Conduit server started.')

    const homeserverUrl = 'http://localhost:8008'

    console.log('Waiting for Conduit to be ready...')
    let isReady = false
    let attempts = 0
    const maxAttempts = 30

    while (!isReady && attempts < maxAttempts) {
      try {
        const res = await fetch(`${homeserverUrl}/_matrix/client/versions`)
        if (res.ok) {
          isReady = true
        } else {
          throw new Error('Not ready')
        }
      } catch (e) {
        attempts++
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    if (!isReady) {
      throw new Error('Conduit server failed to start within the expected time.')
    }
    console.log('Conduit server is ready.')

    console.log('Provisioning test users...')

    const registerUser = async (username, password) => {
      try {
        const response = await fetch(`${homeserverUrl}/_matrix/client/v3/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            auth: {
              type: 'm.login.dummy'
            },
            username: username,
            password: password
          })
        })

        const data = await response.json()
        if (response.ok) {
          console.log(`Successfully provisioned user ${username}`)
        } else {
          console.log(`Failed to provision user ${username}: ${JSON.stringify(data)}`)
        }
      } catch (e) {
        console.error(`Error provisioning user ${username}:`, e)
      }
    }

    await registerUser('alice', 'password123')
    await registerUser('bob', 'password123')

  } catch (err) {
    console.error('Error in global setup:', err)
  }
}

export default globalSetup
