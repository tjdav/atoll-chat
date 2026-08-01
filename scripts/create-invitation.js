import crypto from 'node:crypto'
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || 'admin@example.com'
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || 'password123'

/**
 * Generates a cryptographically secure invitation code formatted as INV-XXXX-XXXX
 */
function generateRandomCode () {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.randomBytes(8)
  let part1 = ''
  let part2 = ''

  for (let i = 0; i < 4; i++) {
    part1 += chars[bytes[i] % chars.length]
    part2 += chars[bytes[i + 4] % chars.length]
  }

  return `INV-${part1}-${part2}`
}

async function main () {
  const pb = new PocketBase(PB_URL)

  try {
    console.log(`Authenticating as superuser (${ADMIN_EMAIL})...`)
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
  } catch (error) {
    console.error('❌ Failed to authenticate as superuser. Is PocketBase running?')
    console.error('Error:', error.message)
    process.exit(1)
  }

  const customCode = process.argv[2]
  const code = customCode ? customCode.trim().toUpperCase() : generateRandomCode()

  console.log(`Creating invitation code: ${code}...`)

  try {
    const invitation = await pb.collection('invitations').create({
      code,
      is_used: false,
      max_uses: 1,
      used_count: 0
    })

    console.log('✅ Invitation created successfully!')
    console.log('-----------------------------------')
    console.log(`Code:       ${invitation.code}`)
    console.log(`ID:         ${invitation.id}`)
    console.log(`Max Uses:   ${invitation.max_uses}`)
    console.log('-----------------------------------')
  } catch (error) {
    console.error('❌ Failed to create invitation:', error.message)
    if (error.data) {
      console.error('Validation Details:', JSON.stringify(error.data, null, 2))
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Execution failed:', err)
  process.exit(1)
})
