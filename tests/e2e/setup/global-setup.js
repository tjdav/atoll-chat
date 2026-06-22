import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import http from 'http'

const execAsync = promisify(exec)

const PB_VERSION = '0.39.4'
const PB_BINARY = path.join(process.cwd(), 'bin', 'pocketbase')
const PID_FILE = path.join(process.cwd(), '.pocketbase.pid')

/**
 * Ensures PocketBase is running natively and fully initialized.
 */
async function globalSetup () {
  console.log('--- PocketBase Native Setup ---')

  const binDir = path.join(process.cwd(), 'bin')
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
  if (!fs.existsSync('./database/pb_data')) {
    fs.mkdirSync('./database/pb_data', { recursive: true })
  }

  console.log('Starting PocketBase natively...')
  const pbLog = fs.openSync(path.join(process.cwd(), 'pocketbase.log'), 'a')
  const pbProcess = spawn(PB_BINARY, [
    'serve',
    '--dir=./database/pb_data',
    '--migrationsDir=./database/pb_migrations',
    '--hooksDir=./pb_hooks',
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
    } catch (e) {
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
    await execAsync(`${PB_BINARY} superuser upsert admin@example.com password123 --dir=./database/pb_data`)
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
}

export default globalSetup
