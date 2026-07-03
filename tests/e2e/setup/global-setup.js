import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import http from 'http'

const execAsync = promisify(exec)

const PB_VERSION = '0.39.4'
const CWD = process.cwd()
const PB_BINARY = path.join(CWD, 'bin', 'pocketbase')
const PID_FILE = path.join(CWD, '.pocketbase.pid')
const PB_DATA = path.join(CWD, 'pb_data')

/**
 * Ensures PocketBase is running natively and fully initialized.
 */
async function globalSetup () {
  console.log('--- PocketBase Native Setup ---')

  const binDir = path.join(CWD, 'bin')
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir)
  }

  if (!fs.existsSync(PB_BINARY)) {
    console.log(`Downloading PocketBase v${PB_VERSION}...`)
    // Determine architecture - already checked it is x86_64 Linux
    const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip`
    const zipPath = path.join(binDir, 'pb.zip')

    try {
      await execAsync(`curl -L ${url} -o ${zipPath}`)
      await execAsync(`unzip -o ${zipPath} pocketbase -d ${binDir}/`)
      await execAsync(`chmod +x ${PB_BINARY}`)
      fs.unlinkSync(zipPath)
      console.log('PocketBase downloaded and extracted.')
    } catch (error) {
      console.error('Failed to download/extract PocketBase:', error)
      throw error
    }
  }

  // Ensure data directory exists
  if (!fs.existsSync(PB_DATA)) {
    fs.mkdirSync(PB_DATA, { recursive: true })
  }

  console.log('Starting PocketBase natively...')
  const pbLog = fs.openSync(path.join(CWD, 'pocketbase.log'), 'a')
  const pbProcess = spawn(PB_BINARY, [
    'serve',
    `--dir=${PB_DATA}`,
    '--migrationsDir=./database/pb_migrations',
    '--hooksDir=./database/pb_hooks',
    '--http=127.0.0.1:8090'
  ], {
    detached: true,
    stdio: ['ignore', pbLog, pbLog]
  })

  pbProcess.unref()
  if (!pbProcess.pid) {
    throw new Error('Failed to start PocketBase process')
  }
  fs.writeFileSync(PID_FILE, pbProcess.pid.toString())
  console.log(`PocketBase started with PID: ${pbProcess.pid}`)

  console.log('Waiting for PocketBase to be healthy...')
  let healthy = false
  for (let i = 0; i < 30; i++) {
    try {
      const responseCode = await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:8090/api/health', (res) => {
          resolve(res.statusCode)
        })
        req.on('error', reject)
        req.end()
      })

      if (responseCode === 200) {
        healthy = true
        break
      }
    } catch {
      // Still starting up
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  if (!healthy) {
    throw new Error('PocketBase failed to become healthy within 30 seconds')
  }

  console.log('Ensuring superuser exists...')
  try {
    // PocketBase v0.39.x uses 'superuser upsert' for idempotency
    // We use the same credentials as in docker-compose and provision-users.js
    await execAsync(`${PB_BINARY} superuser upsert admin@example.com password123 --dir=${PB_DATA}`)
    console.log('Superuser ensured (upserted).')
  } catch (error) {
    console.error('Superuser creation failed:', error.stdout, error.stderr)
    throw error
  }

  console.log('PocketBase server is ready. Provisioning test users...')
  try {
    await execAsync('node scripts/provision-users.js')
    console.log('Provisioning complete.')
  } catch (error) {
    console.error('Provisioning failed:', error)
    throw error
  }

  // Create a template for fast resets between tests
  console.log('Creating PocketBase data template...')
  const PB_DATA_TEMPLATE = path.join(CWD, 'pb_data_template')

  // We need to stop PB to safely copy the data directory
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10)
    try {
      process.kill(pid, 'SIGTERM')
      // Wait for shutdown
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (e) {
      console.warn('Failed to stop PB for template creation:', e.message)
    }
  }

  if (fs.existsSync(PB_DATA_TEMPLATE)) {
    fs.rmSync(PB_DATA_TEMPLATE, {
      recursive: true,
      force: true
    })
  }
  fs.cpSync(PB_DATA, PB_DATA_TEMPLATE, { recursive: true })
  console.log('PocketBase data template created.')

  // Restart PB for the tests
  console.log('Restarting PocketBase...')
  const pbLogRestart = fs.openSync(path.join(CWD, 'pocketbase.log'), 'a')
  const pbProcessRestart = spawn(PB_BINARY, [
    'serve',
    `--dir=${PB_DATA}`,
    '--migrationsDir=./database/pb_migrations',
    '--hooksDir=./database/pb_hooks',
    '--http=127.0.0.1:8090'
  ], {
    detached: true,
    stdio: ['ignore', pbLogRestart, pbLogRestart]
  })

  pbProcessRestart.unref()
  if (!pbProcessRestart.pid) {
    throw new Error('Failed to restart PocketBase process')
  }
  fs.writeFileSync(PID_FILE, pbProcessRestart.pid.toString())
}

export default globalSetup
