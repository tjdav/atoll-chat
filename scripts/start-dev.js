import { spawn } from 'child_process'
import globalSetup from '../tests/e2e/setup/global-setup.js'
import globalTeardown from '../tests/e2e/setup/global-teardown.js'

let isTearingDown = false
let appProcess = null
let trackerProcess = null

// Centralized cleanup function to ensure teardown only happens once
const cleanupAndExit = async (code = 0) => {
  if (isTearingDown) {
    return
  }
  isTearingDown = true

  console.log('\nInitiating teardown process...')

  // Terminate the app process if it's still running
  if (appProcess && !appProcess.killed) {
    appProcess.kill('SIGINT')
  }

  // Terminate the tracker process if it's still running
  if (trackerProcess && !trackerProcess.killed) {
    trackerProcess.kill('SIGINT')
  }

  try {
    await globalTeardown()
    process.exit(code)
  } catch (error) {
    console.error('Failed during teardown:', error)
    process.exit(1)
  }
}

const run = async () => {
  try {
    // 1. Run the Docker Compose setup and provisioning
    await globalSetup()

    console.log('\n--- Starting Tracker Server ---')
    // 2. Spawn the tracker process
    trackerProcess = spawn('pnpm', ['run', 'start:tracker'], {
      stdio: 'inherit',
      shell: true
    })

    trackerProcess.on('close', async (code) => {
      console.log(`\nTracker process exited with code ${code}`)
      await cleanupAndExit(code)
    })

    console.log('\n--- Starting Application ---')
    // 3. Spawn the app process using pnpm
    appProcess = spawn('pnpm', ['run', 'start:app'], {
      stdio: 'inherit',
      shell: true
    })

    // 4. Listen for the app process closing naturally or crashing
    appProcess.on('close', async (code) => {
      console.log(`\nApplication process exited with code ${code}`)
      await cleanupAndExit(code)
    })

    // 5. Catch user interrupts (e.g., pressing Ctrl+C in the terminal)
    process.on('SIGINT', () => cleanupAndExit(0))
    process.on('SIGTERM', () => cleanupAndExit(0))

  } catch (error) {
    console.error('Failed to start environment:', error)
    await cleanupAndExit(1)
  }
}

run()
