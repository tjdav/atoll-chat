// database/pb_hooks/initial_invite.pb.js

/**
 * Hook executed during PocketBase bootstrap.
 * Detects if the database has 0 users (first-boot).
 * If empty, generates or retrieves a one-time invitation setup code and
 * prints a clean setup link message to the terminal log.
 *
 * @param {core.BootstrapEvent} e - The PocketBase bootstrap event.
 * @returns {void}
 */
onBootstrap((e) => {
  e.next()

  /**
   * Retrieves environment variable value across runtime environments.
   *
   * @param {string} key - Environment variable name.
   * @returns {string|undefined}
   */
  function getEnv (key) {
    if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
      return process.env[key]
    }

    if (typeof $os !== 'undefined' && typeof $os.getenv === 'function') {
      return $os.getenv(key)
    }

    return undefined
  }

  const collections = e.app.findAllCollections()
  const usersColl = collections.find((c) => (c.name || c.Name) === 'users')
  const invitesColl = collections.find((c) => (c.name || c.Name) === 'invitations')

  if (!usersColl || !invitesColl) {
    return
  }

  // Count registered users
  let userCount = 0
  try {
    const countResult = new DynamicModel({ count: 0 })
    e.app.db().select('count(*) as count').from('users').one(countResult)
    userCount = countResult.count
  } catch (err) {
    e.app.logger().error('[initial_invite.pb.js] Error counting users:', 'error', err.message || String(err))
    return
  }

  if (userCount > 0) {
    return
  }

  // Find or generate initial setup code
  let inviteCode = ''
  let existingInvites = []
  try {
    existingInvites = e.app.findRecordsByFilter('invitations', 'is_used = false && (created_by = "" || created_by = null)', '-created', 1, 0)
  } catch (err) {
    // If filter fails, attempt simpler filter query
    try {
      existingInvites = e.app.findRecordsByFilter('invitations', 'is_used = false', '-created', 1, 0)
    } catch {
      existingInvites = []
    }
  }

  if (existingInvites && existingInvites.length > 0) {
    inviteCode = existingInvites[0].get('code')
  } else {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const part1 = $security.randomStringWithAlphabet(4, chars)
    const part2 = $security.randomStringWithAlphabet(4, chars)
    inviteCode = `INV-${part1}-${part2}`

    try {
      const record = new Record(invitesColl)
      record.set('code', inviteCode)
      record.set('is_used', false)
      record.set('max_uses', 1)
      record.set('used_count', 0)
      e.app.save(record)
    } catch (err) {
      e.app.logger().error('[initial_invite.pb.js] Failed to save initial invite record:', 'error', err.message || String(err))
      return
    }
  }

  // Resolve App URL
  let appUrl = getEnv('ATOLL_APP_URL')
  if (!appUrl) {
    try {
      const metaRecords = e.app.findRecordsByFilter('app_metadata', '1=1', '', 1, 0)
      if (metaRecords.length > 0 && metaRecords[0].get('app_url')) {
        appUrl = metaRecords[0].get('app_url')
      }
    } catch {
      // Fallback if app_metadata not initialized yet
    }
  }

  if (!appUrl) {
    appUrl = 'http://localhost:3000'
  }
  appUrl = appUrl.replace(/\/+$/, '')

  const setupUrl = `${appUrl}/?invite=${inviteCode}`

  console.log('')
  console.log('----------------------------------------------------------------------')
  console.log('🔑 Atoll Chat - Initial Owner Setup')
  console.log('No user accounts detected. To create your first owner account, visit:')
  console.log('')
  console.log(`  ${setupUrl}`)
  console.log('')
  console.log(`Invitation Code: ${inviteCode}`)
  console.log('----------------------------------------------------------------------')
  console.log('')

  e.app.logger().info('[initial_invite.pb.js] Initial setup link generated', 'url', setupUrl, 'code', inviteCode)
})
