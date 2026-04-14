import { exec } from 'child_process'
import { promisify } from 'util'
import PocketBase from 'pocketbase'

const execAsync = promisify(exec)

/**
 *
 */
async function globalSetup () {
  console.log('Starting PocketBase local server via Docker Compose...')
  try {
    await execAsync('docker compose up -d pocketbase')
    console.log('PocketBase server started.')

    const pbUrl = 'http://localhost:8090'

    console.log('Waiting for PocketBase to be ready...')
    let isReady = false
    let attempts = 0
    const maxAttempts = 30

    while (!isReady && attempts < maxAttempts) {
      try {
        const response = await fetch(`${pbUrl}/api/health`)
        if (response.ok) {
          isReady = true
        } else {
          throw new Error('Not ready')
        }
      } catch (error) {
        attempts++
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    if (!isReady) {
      throw new Error('PocketBase server failed to start within the expected time.')
    }
    console.log('PocketBase server is ready.')

    const pb = new PocketBase(pbUrl)

    await pb.collection('_superusers').authWithPassword('admin@example.com', 'password123')
    await pb.collection('users').authWithPassword('alice@example.com', 'password123')
    await pb.collection('users').authWithPassword('bob@example.com', 'password123')
    await pb.collection('users').authWithPassword('charlie@example.com', 'password123')

  } catch (error) {
    console.error('Error in global setup:', error)
  }
}

export default globalSetup
