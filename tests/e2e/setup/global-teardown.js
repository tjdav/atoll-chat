import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 *
 */
async function globalTeardown () {
  console.log('Stopping Continuwuity local server via Docker Compose...')
  try {
    await execAsync('docker compose down -v')
    console.log('Continuwuity server stopped and volumes removed.')
  } catch (error) {
    console.error('Error in global teardown:', error)
  }
}

export default globalTeardown
