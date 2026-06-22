import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * Ensures Docker is running and Pocketbase is fully initialized.
 */
async function globalSetup () {
  console.log('Starting PocketBase local server via Docker Compose...')
  try {
    await execAsync('docker compose up -d pocketbase')

    console.log('Waiting for PocketBase to be healthy...')
    let healthy = false
    for (let i = 0; i < 30; i++) {
      try {
        const { stdout } = await execAsync('docker inspect --format="{{.State.Health.Status}}" pocketbase-dev')
        if (stdout.trim() === 'healthy') {
          healthy = true
          break
        }
      } catch (e) {
        // Ignore errors during initial startup
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    if (!healthy) {
      throw new Error('PocketBase failed to become healthy within 30 seconds')
    }

    console.log('PocketBase server is ready. Provisioning test users...')
    await execAsync('node scripts/provision-users.js')
    console.log('Provisioning complete.')
  } catch (error) {
    console.error('Error in global setup:', error)
    throw error
  }
}

export default globalSetup
