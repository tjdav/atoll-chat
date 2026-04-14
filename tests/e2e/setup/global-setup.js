import { exec } from 'child_process'
import { promisify } from 'util'
import PocketBase from 'pocketbase'

const execAsync = promisify(exec)

/**
 * Ensures a user exists and authenticates them.
 *
 * @param {PocketBase} pb - The PocketBase instance.
 * @param {string} email - The user's email.
 * @param {string} password - The user's password.
 */
async function ensureUserAndAuth (pb, email, password) {
  try {
    await pb.collection('users').authWithPassword(email, password)
  } catch (error) {
    console.log(`User ${email} not found, creating...`)
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password
    })
    await pb.collection('users').authWithPassword(email, password)
  }
}

/**
 *
 */
async function globalSetup () {
  console.log('Starting PocketBase local server via Docker Compose...')
  try {
    await execAsync('docker compose up -d pocketbase')
    console.log('PocketBase server started.')

    const pbUrl = 'http://localhost:8090'

    console.log('Waiting for PocketBase to be ready...')
    let isReady = false
    let attempts = 0
    const maxAttempts = 30

    while (!isReady && attempts < maxAttempts) {
      try {
        const response = await fetch(`${pbUrl}/api/health`)
        if (response.ok) {
          isReady = true
        } else {
          throw new Error('Not ready')
        }
      } catch (error) {
        attempts++
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    if (!isReady) {
      throw new Error('PocketBase server failed to start within the expected time.')
    }
    console.log('PocketBase server is ready.')

    // Ensure superuser is created using CLI (as SDK requires superuser to create superuser)
    try {
      await execAsync('docker compose exec pocketbase /usr/local/bin/pocketbase superuser upsert admin@example.com password123')
      console.log('Superuser upserted.')
    } catch (error) {
      console.error('Failed to upsert superuser:', error)
    }

    const pb = new PocketBase(pbUrl)

    await pb.collection('_superusers').authWithPassword('admin@example.com', 'password123')

    await ensureUserAndAuth(pb, 'alice@example.com', 'password123')
    await ensureUserAndAuth(pb, 'bob@example.com', 'password123')
    await ensureUserAndAuth(pb, 'charlie@example.com', 'password123')

    console.log('Test users verified/created successfully.')
  } catch (error) {
    console.error('Error in global setup:', error)
    throw error
  }
}

export default globalSetup
