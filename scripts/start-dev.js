import { spawn, execSync } from 'child_process'
import http from 'http'
import fs from 'fs'
import path from 'path'

let isTearingDown = false
let appProcess = null
let pbProcess = null
let isDockerUsed = false

// Helper to run commands silently without crashing
function runCommandSilently (cmd, options = {}) {
  try {
    execSync(cmd, { stdio: 'ignore', ...options })
    return true
  } catch {
    return false
  }
}

// Check if http://127.0.0.1:8090/api/health is online
function checkHealth () {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:8090/api/health', (res) => {
      resolve(res.statusCode === 200)
    }).on('error', () => {
      resolve(false)
    })
  })
}

// Wait for health check with polling
async function waitForPocketBase (timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await checkHealth()
    if (ok) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

// Get path to local pocketbase binary (fallback)
function getLocalPocketBaseBinary () {
  const binDir = path.join(process.cwd(), 'bin')
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(binDir, `pocketbase${ext}`)
}

// Ensure local pocketbase binary is downloaded (fallback)
async function ensureLocalPocketBaseDownloaded () {
  const binaryPath = getLocalPocketBaseBinary()
  if (fs.existsSync(binaryPath)) {
    console.log('Local PocketBase binary already exists.')
    return binaryPath
  }

  const binDir = path.join(process.cwd(), 'bin')
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true })
  }

  const platform = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'darwin' : 'linux')
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const zipName = `pocketbase_0.39.7_${platform}_${arch}.zip`
  const downloadUrl = `https://github.com/pocketbase/pocketbase/releases/download/v0.39.7/${zipName}`

  console.log(`Downloading PocketBase from ${downloadUrl}...`)

  if (process.platform === 'win32') {
    const cmd = `powershell -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${zipName}'; Expand-Archive -Path '${zipName}' -DestinationPath 'bin' -Force; Remove-Item '${zipName}'"`
    execSync(cmd, { stdio: 'inherit' })
  } else {
    const hasWget = runCommandSilently('which wget')
    if (hasWget) {
      execSync(`wget -q ${downloadUrl} -O ${zipName}`, { stdio: 'inherit' })
    } else {
      execSync(`curl -L -q ${downloadUrl} -o ${zipName}`, { stdio: 'inherit' })
    }
    execSync(`unzip -o ${zipName} -d bin`, { stdio: 'inherit' })
    execSync(`rm ${zipName}`, { stdio: 'inherit' })
    execSync(`chmod +x "${binaryPath}"`, { stdio: 'inherit' })
  }

  if (!fs.existsSync(binaryPath)) {
    throw new Error('Failed to download/extract PocketBase local binary.')
  }

  console.log('PocketBase local binary is ready.')
  return binaryPath
}

// Teardown everything
const cleanupAndExit = async (code = 0) => {
  if (isTearingDown) {
    return
  }
  isTearingDown = true

  console.log('\nInitiating teardown process...')

  if (appProcess && !appProcess.killed) {
    console.log('Stopping frontend app process...')
    appProcess.kill('SIGINT')
  }

  if (isDockerUsed) {
    console.log('Stopping PocketBase and Coturn containers via Docker Compose...')
    try {
      execSync('docker compose -f docker-compose.dev.yml down', { stdio: 'inherit' })
    } catch (err) {
      console.error('Failed to teardown Docker compose:', err.message)
    }
  } else if (pbProcess) {
    console.log('Stopping local PocketBase process...')
    pbProcess.kill('SIGINT')
  }

  process.exit(code)
}

const run = async () => {
  try {
    console.log('--- PocketBase & Coturn Dev Environment Setup ---')
    let dockerStarted = false

    try {
      console.log('Attempting to spin up dev services via Docker Compose...')
      execSync('docker compose -f docker-compose.dev.yml up -d --build', { stdio: 'inherit' })
      isDockerUsed = true
      dockerStarted = true
      console.log('Dev services started successfully via Docker Compose.')
    } catch (error) {
      console.warn('Docker compose failed/unavailable. Falling back to local PocketBase binary...', error.message)
      isDockerUsed = false
    }

    if (!dockerStarted) {
      console.log('Setting up local PocketBase fallback...')
      const localBinary = await ensureLocalPocketBaseDownloaded()

      console.log('Starting local PocketBase binary on port 8090...')
      pbProcess = spawn(localBinary, [
        'serve',
        '--http=127.0.0.1:8090',
        '--dir=pb_data',
        '--hooksDir=database/pb_hooks',
        '--migrationsDir=database/pb_migrations'
      ], {
        stdio: 'inherit'
      })
    }

    // Wait for health check
    console.log('Waiting for PocketBase to be healthy on port 8090...')
    const healthy = await waitForPocketBase()
    if (!healthy) {
      throw new Error('PocketBase failed to become healthy on port 8090 after 30 seconds.')
    }
    console.log('PocketBase is healthy and listening on port 8090.')

    // Ensure superuser is created (moved here to prevent race conditions before service is healthy)
    console.log('Ensuring superuser admin exists...')
    if (isDockerUsed) {
      runCommandSilently('docker exec -i atoll-pocketbase-dev /usr/local/bin/pocketbase superuser create admin@example.com password123')
    } else {
      const localBinary = getLocalPocketBaseBinary()
      runCommandSilently(`"${localBinary}" superuser create admin@example.com password123 --dir=pb_data`)
    }

    // Run provisioning of test users (Alice, Bob, Charlie)
    console.log('Provisioning test users (Alice, Bob, Charlie)...')
    try {
      execSync('node scripts/provision-users.js', { stdio: 'inherit' })
    } catch (err) {
      console.error('Failed to provision test users:', err.message)
    }

    console.log('\n--- Starting Application ---')
    appProcess = spawn('pnpm', ['run', 'start:app'], {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        LOCAL_ICE_SERVER: `turn:127.0.0.1:${process.env.TURN_PORT || 3478}`
      }
    })

    appProcess.on('close', async (code) => {
      console.log(`\nApplication process exited with code ${code}`)
      await cleanupAndExit(code)
    })

    process.on('SIGINT', () => cleanupAndExit(0))
    process.on('SIGTERM', () => cleanupAndExit(0))

  } catch (error) {
    console.error('Failed to start environment:', error)
    await cleanupAndExit(1)
  }
}

run()
