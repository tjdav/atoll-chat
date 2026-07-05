import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execAsync = promisify(exec)
const PID_FILE = path.join(process.cwd(), '.pocketbase.pid')
const PB_DATA = path.join(process.cwd(), 'pb_data_test')
/**
 * Stops the native PocketBase server and clears data.
 */
async function globalTeardown () {
  console.log('--- PocketBase Teardown ---')

  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10)
    console.log(`Stopping PocketBase process with PID: ${pid}`)
    try {
      process.kill(pid, 'SIGTERM')
      // Wait a bit for it to shut down
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`Failed to kill PocketBase (PID ${pid}):`, error.message)
    }
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE)
    }
  } else {
    console.log('No PocketBase PID file found.')
  }

  // Also manually clear the bind-mounted data directory to ensure a fresh state
  if (fs.existsSync(PB_DATA)) {
    console.log('Clearing PocketBase data directory...')
    fs.rmSync(PB_DATA, {
      recursive: true,
      force: true
    })
  }

  console.log('PocketBase server stopped and data cleared.')
}

export default globalTeardown
