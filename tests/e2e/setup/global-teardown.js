import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'

const execAsync = promisify(exec)

/**
 *
 */
async function globalTeardown () {
  console.log('Stopping Pocketbase server via Docker Compose...')
  try {
    await execAsync('docker compose down -v')
    // Also manually clear the bind-mounted data directory to ensure a fresh state
    if (fs.existsSync('./database/pb_data')) {
      fs.rmSync('./database/pb_data', { recursive: true, force: true })
    }
    console.log('Pocketbase server stopped and data cleared.')
  } catch (error) {
    console.error('Error in global teardown:', error)
  }
}

export default globalTeardown
