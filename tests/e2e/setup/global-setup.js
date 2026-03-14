import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function globalSetup () {
  console.log('Starting Dendrite local server via Docker Compose...')
  try {
    await execAsync('docker-compose up -d')
    console.log('Dendrite server started.')

    // Wait a few seconds to ensure Dendrite is fully up before provisioning users
    await new Promise(resolve => setTimeout(resolve, 5000))

    const homeserverUrl = 'http://localhost:8008'

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
