import { spawn, execSync } from 'child_process'
import http from 'http'
import fs from 'fs'
import path from 'path'

let isTearingDown = false
let appProcess = null
let pbProcess = null
let pushWorkerProcess = null
let isDockerUsed = false
let dockerComposeCmd = 'docker compose'

// Helper to run commands silently without crashing
function runCommandSilently (cmd, options = {}) {
  try {
    execSync(cmd, {
      stdio: 'ignore',
      ...options
    })
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

  let platform = 'linux'

  if (process.platform === 'win32') {
    platform = 'windows'
  } else if (process.platform === 'darwin') {
    platform = 'darwin'
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const zipName = `pocketbase_0.39.8_${platform}_${arch}.zip`
  const downloadUrl = `https://github.com/pocketbase/pocketbase/releases/download/v0.39.8/${zipName}`

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

  let exitCode = code
  if (exitCode === null || exitCode === 130 || exitCode === 'SIGINT' || exitCode === 'SIGTERM') {
    exitCode = 0
  }

  console.log('\nInitiating teardown process...')

  if (appProcess && !appProcess.killed) {
    console.log('Stopping frontend app process...')
    appProcess.kill('SIGINT')
  }

  if (pushWorkerProcess && !pushWorkerProcess.killed) {
    console.log('Stopping local push-worker process...')
    pushWorkerProcess.kill('SIGINT')
  }

  if (isDockerUsed) {
    console.log(`Stopping PocketBase and Coturn containers via ${dockerComposeCmd}...`)
    try {
      execSync(`${dockerComposeCmd} -f docker-compose.dev.yml down`, { stdio: 'inherit' })
    } catch (err) {
      console.error('Failed to teardown Docker compose:', err.message)
    }
  } else if (pbProcess) {
    console.log('Stopping local PocketBase process...')
    pbProcess.kill('SIGINT')
  }

  process.exit(exitCode)
}

const run = async () => {
  try {
    console.log('--- PocketBase & Coturn Dev Environment Setup ---')

    // Load .env file if it exists (Node 24+)
    if (fs.existsSync('.env')) {
      process.loadEnvFile('.env')
      console.log('Loaded .env file successfully.')
    }

    // Pre-create pb_data or verify permissions
    if (fs.existsSync('./pb_data')) {
      try {
        fs.accessSync('./pb_data', fs.constants.W_OK)
      } catch (_err) {
        console.error(`\n======================================================================`)
        console.error(`Error: The directory 'pb_data' exists but is not writable by the current user.`)
        console.error(`This typically happens if a previous Docker run created it as 'root'.`)
        console.error(`To resolve this issue, please run the following command in your terminal:`)
        console.error(`    sudo chown -R $USER pb_data`)
        console.error(`Or, if you want to reset your local development database:`)
        console.error(`    sudo rm -rf pb_data`)
        console.error(`======================================================================\n`)
        process.exit(1)
      }
    } else {
      try {
        console.log('Pre-creating `./pb_data` directory to ensure it is owned by the current host user...')
        fs.mkdirSync('./pb_data', { recursive: true })
      } catch (err) {
        console.warn('Warning: Failed to pre-create pb_data directory:', err.message)
      }
    }

    let dockerStarted = false

    try {
      console.log('Cleaning up any existing/conflicting Docker containers...')
      runCommandSilently('docker rm -f atoll-pocketbase-dev atoll-coturn')

      console.log('Attempting to spin up dev services via Docker Compose...')
      const env = {
        ...process.env,
        HOST_UID: process.getuid ? process.getuid() : 1000,
        HOST_GID: process.getgid ? process.getgid() : 1000
      }

      // Try 'docker compose' first
      try {
        execSync('docker compose -f docker-compose.dev.yml up -d --build', {
          stdio: 'inherit',
          env
        })
        dockerComposeCmd = 'docker compose'
        isDockerUsed = true
        dockerStarted = true
      } catch (err1) {
        console.warn('docker compose failed, trying fallback docker-compose...')
        try {
          execSync('docker-compose -f docker-compose.dev.yml up -d --build', {
            stdio: 'inherit',
            env
          })
          dockerComposeCmd = 'docker-compose'
          isDockerUsed = true
          dockerStarted = true
        } catch (err2) {
          throw new Error(`Both docker compose and docker-compose failed.\n` +
            `docker compose error: ${err1.message}\n` +
            `docker-compose error: ${err2.message}`)
        }
      }
      console.log(`Dev services started successfully via Docker Compose using: ${dockerComposeCmd}`)
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
        stdio: 'inherit',
        env: {
          ...process.env,
          ATOLL_PUSH_WORKER_URL: 'http://localhost:3001',
          ATOLL_PUSH_WORKER_SECRET: 'test_secret_123'
        }
      })
    }

    // Start local push-worker process
    console.log('Starting local push-worker on port 3001...')
    const pushWorkerDir = path.join(process.cwd(), 'push-worker')
    console.log('Installing dependencies for push-worker...')
    try {
      execSync('pnpm install --ignore-workspace', {
        cwd: pushWorkerDir,
        stdio: 'inherit'
      })
    } catch (err) {
      throw new Error(`Failed to install dependencies for push-worker: ${err.message}`)
    }

    pushWorkerProcess = spawn('node', ['index.js'], {
      cwd: pushWorkerDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: '3001',
        ATOLL_PUSH_WORKER_SECRET: 'test_secret_123',
        ATOLL_INTERNAL_POCKETBASE_URL: 'http://localhost:8090'
      }
    })

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
        LOCAL_ICE_SERVER: `turn:127.0.0.1:${process.env.TURN_PORT || 3478}`,
        ATOLL_PUSH_WORKER_URL: 'http://localhost:3001',
        ATOLL_PUSH_WORKER_SECRET: 'test_secret_123'
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
