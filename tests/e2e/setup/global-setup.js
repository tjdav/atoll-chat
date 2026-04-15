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
    console.log('PocketBase server is ready.')
  } catch (error) {
    console.error('Error in global setup:', error)
    throw error
  }
}

export default globalSetup
