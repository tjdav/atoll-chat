import { spawn, execSync } from 'child_process'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { networkInterfaces } from 'os'

function getLocalIp () {
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
  return 'localhost'
}

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
  const zipName = `pocketbase_0.39.10_${platform}_${arch}.zip`
  const downloadUrl = `https://github.com/pocketbase/pocketbase/releases/download/v0.39.10/${zipName}`

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

  // Helper to gracefully kill and wait for a process to fully close
  const stopProcess = (proc, name) => {
    return new Promise((resolve) => {
      if (!proc || proc.killed) {
        return resolve()
      }

      console.log(`Stopping ${name}...`)

      let isResolved = false

      // Fallback: If it doesn't close cleanly in 5 seconds, force kill it
      const timeout = setTimeout(() => {
        if (isResolved) {
          return
        }
        console.warn(`Force killing ${name} (timed out waiting for graceful exit)...`)
        try {
          proc.kill('SIGKILL')
        } catch {
        }
        isResolved = true
        resolve()
      }, 5000)

      const onExit = () => {
        if (isResolved) {
          return
        }
        clearTimeout(timeout)
        isResolved = true
        resolve()
      }

      proc.on('close', onExit)
      proc.on('exit', onExit)
      proc.kill('SIGINT')
    })
  }

  // Await the graceful shutdown of our spawned processes
  await stopProcess(appProcess, 'frontend app process')
  await stopProcess(pushWorkerProcess, 'local push-worker process')

  if (isDockerUsed) {
    console.log(`Stopping PocketBase and Coturn containers via ${dockerComposeCmd}...`)
    try {
      execSync(`${dockerComposeCmd} -f docker-compose.dev.yml down`, { stdio: 'inherit' })
    } catch (err) {
      console.error('Failed to teardown Docker compose:', err.message)
    }
  } else if (pbProcess) {
    await stopProcess(pbProcess, 'local PocketBase process')
  }

  console.log('Teardown complete. Exiting.')
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
      runCommandSilently('docker rm -f atoll-pocketbase-dev atoll-coturn atoll-caddy-dev')

      console.log('Attempting to spin up dev services via Docker Compose...')
      const env = {
        ...process.env,
        HOST_UID: process.getuid ? process.getuid() : 1000,
        HOST_GID: process.getgid ? process.getgid() : 1000
      }

      let composeCmd = null
      try {
        // Check for V2 silently
        execSync('docker compose version', {
          stdio: 'ignore',
          env
        })
        composeCmd = 'docker compose'
      } catch {
        console.warn('docker compose (V2) not found, trying docker-compose (V1)...')
        try {
          // Check for V1 silently
          execSync('docker-compose --version', {
            stdio: 'ignore',
            env
          })
          composeCmd = 'docker-compose'
        } catch {
          throw new Error('Neither docker compose nor docker-compose is installed.')
        }
      }

      // Run the build with the correct command
      execSync(`${composeCmd} -f docker-compose.dev.yml up -d --build`, {
        stdio: 'inherit',
        env
      })

      // (Assuming dockerComposeCmd is defined somewhere above in your original code)
      dockerComposeCmd = composeCmd
      isDockerUsed = true
      dockerStarted = true
      console.log(`Dev services started successfully via Docker Compose using: ${composeCmd}`)

    } catch (error) {
      console.warn('Docker compose failed/unavailable. Falling back to local PocketBase binary...', error.message)
      isDockerUsed = false
    }

    if (!dockerStarted) {
      console.log('Setting up local PocketBase fallback...')
      const localBinary = await ensureLocalPocketBaseDownloaded()

      console.log('Ensuring superuser admin exists in local database...')
      try {
        execSync(`"${localBinary}" superuser upsert admin@example.com password123 --dir=pb_data`, { stdio: 'inherit' })
      } catch (err) {
        console.warn('Warning: Failed to upsert local superuser:', err.message)
      }

      console.log('Starting local PocketBase binary on port 8090...')
      pbProcess = spawn(localBinary, [
        'serve',
        '--http=0.0.0.0:8090',
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
        ATOLL_INTERNAL_POCKETBASE_URL: 'http://localhost:8090',
        ATOLL_ALTCHA_COST: '100'
      }
    })

    // Wait for health check
    console.log('Waiting for PocketBase to be healthy on port 8090...')
    const healthy = await waitForPocketBase()
    if (!healthy) {
      throw new Error('PocketBase failed to become healthy on port 8090 after 30 seconds.')
    }
    console.log('PocketBase is healthy and listening on port 8090.')

    // Ensure superuser is created or updated (upsert ensures password is reset if user already exists)
    if (isDockerUsed) {
      console.log('Ensuring superuser admin exists in Docker container...')
      try {
        execSync('docker exec -w /pb -i atoll-pocketbase-dev /usr/local/bin/pocketbase superuser upsert admin@example.com password123 --dir=/pb/pb_data', { stdio: 'inherit' })
      } catch (err) {
        console.warn('Warning: Failed to upsert docker superuser:', err.message)
      }
    }

    // Run provisioning of test users (Alice, Bob, Charlie)
    console.log('Provisioning test users (Alice, Bob, Charlie)...')
    try {
      execSync('node scripts/provision-users.js', { stdio: 'inherit' })
    } catch (err) {
      console.error('Failed to provision test users:', err.message)
    }

    // Print the HTTPS dev links box (Android/iOS need TLS via Caddy)
    function printDevLinks (localIp) {
      const PAD = 2
      const title = '🔒 Atoll HTTPS Dev Links (Caddy TLS Proxy)'
      const rows = [
        `🌐  Web App  ·  Network   https://${localIp}:3443`,
        `🗄️  Admin    ·  Network   https://${localIp}:8443/_/`,
        '',
        'ℹ️  HTTPS (via Caddy TLS) is required by Android /',
        '    iOS to reach your local dev server.'
      ]

      // Approximate terminal display width (emoji/CJK ~ 2 cols, VS16 = 0)
      const width = (s) => [...s].reduce((w, ch) => {
        const cp = ch.codePointAt(0)
        if (cp === 0xfe0f) {
          return w
        }

        return w + (cp > 0x2fff ? 2 : 1)
      }, 0)

      const innerWidth = Math.max(...rows.map(r => width(r)), width(title))
      const total = innerWidth + PAD * 2
      const ruler = '─'.repeat(total)
      const blank = '│' + ' '.repeat(total) + '│'
      const line = (s, pad = PAD) => '│' + ' '.repeat(pad) + s + ' '.repeat(Math.max(0, total - pad - width(s))) + '│'

      console.log('')
      console.log('┌' + ruler + '┐')
      console.log(line(title, Math.floor((total - width(title)) / 2)))
      console.log(blank)
      for (const r of rows) {
        console.log(r === '' ? blank : line(r))
      }
      console.log('└' + ruler + '┘')
      console.log('')
    }

    console.log('\n--- Starting Application ---')
    const localIp = getLocalIp()
    printDevLinks(localIp)
    const appEnv = {
      ...process.env,
      ATOLL_PUSH_WORKER_URL: 'http://localhost:3001',
      ATOLL_PUSH_WORKER_SECRET: 'test_secret_123'
    }
    if (isDockerUsed) {
      appEnv.LOCAL_ICE_SERVER = `turn:127.0.0.1:${process.env.TURN_PORT || 3478}`
    }

    appProcess = spawn('pnpm', ['run', 'start:app'], {
      stdio: 'inherit',
      shell: true,
      env: appEnv
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
