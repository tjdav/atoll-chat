// database/pb_hooks/initial_invite.pb.js

/**
 * Hook executed during PocketBase bootstrap.
 * Detects if the database has 0 users (first-boot).
 * If empty, generates or retrieves a one-time invitation setup code and
 * dispatches a transactional email to the owner without outputting secrets to stdout.
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

  /**
   * Resolves recipient email address following priority:
   * 1. ATOLL_OWNER_EMAIL
   * 2. PB_ADMIN_EMAIL
   * 3. First superuser email from PocketBase `_superusers` collection
   *
   * @returns {string|null}
   */
  function getOwnerEmail () {
    let email = getEnv('ATOLL_OWNER_EMAIL')
    if (email && email.trim() !== '') {
      return email.trim()
    }

    email = getEnv('PB_ADMIN_EMAIL')
    if (email && email.trim() !== '') {
      return email.trim()
    }

    try {
      const superuserRecords = e.app.findRecordsByFilter('_superusers', 'email != ""', '-created', 1, 0)
      if (superuserRecords && superuserRecords.length > 0) {
        const suEmail = superuserRecords[0].get('email')
        if (suEmail && suEmail.trim() !== '') {
          return suEmail.trim()
        }
      }
    } catch {
      // Ignore filter error if _superusers collection or query fails
    }

    return null
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

  // Resolve recipient owner email
  const ownerEmail = getOwnerEmail()
  if (!ownerEmail) {
    e.app.logger().error('[initial_invite.pb.js] Initial owner setup invitation email not sent: No recipient email configured. Set ATOLL_OWNER_EMAIL or PB_ADMIN_EMAIL.')
    return
  }

  // Resolve sender metadata from PocketBase settings
  const settings = e.app.settings()
  const meta = settings.meta || {}
  const senderName = meta.senderName || 'Atoll Chat'
  const senderAddress = meta.senderAddress || 'noreply@atoll.chat'

  // Construct transactional setup email
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Complete Owner Setup</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px; color: #111111; }
        .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .header { text-align: center; margin-bottom: 24px; }
        .header h1 { font-size: 24px; margin: 0; color: #0d6efd; }
        .content { font-size: 16px; line-height: 1.6; margin-bottom: 28px; }
        .button-wrapper { text-align: center; margin: 32px 0; }
        .btn { display: inline-block; background-color: #0d6efd; color: #ffffff !important; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; }
        .code-box { background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 12px 16px; font-family: monospace; font-size: 18px; text-align: center; letter-spacing: 2px; font-weight: bold; color: #212529; margin: 16px 0; }
        .footer { font-size: 13px; color: #6c757d; border-top: 1px solid #e9ecef; padding-top: 16px; margin-top: 24px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Atoll Chat Initial Setup</h1>
        </div>
        <div class="content">
          <p>Welcome to Atoll Chat!</p>
          <p>No user accounts exist on this instance yet. You have been designated as the owner. Use the button below to complete your initial owner account registration:</p>
          <div class="button-wrapper">
            <a href="${setupUrl}" class="btn" target="_blank">Complete Owner Setup</a>
          </div>
          <p>Alternatively, you can manually enter your single-use invitation code during registration:</p>
          <div class="code-box">${inviteCode}</div>
          <p><em>Note: This single-use setup link and invitation code are strictly intended for setting up the initial owner account.</em></p>
        </div>
        <div class="footer">
          <p>&copy; Atoll Chat. Sent automatically by your Atoll instance bootstrap hook.</p>
        </div>
      </div>
    </body>
    </html>
  `

  const textContent = `
Welcome to Atoll Chat!

No user accounts exist on this instance yet. You have been designated as the owner. Use the link or code below to complete your initial owner account registration:

Setup Link: ${setupUrl}
Invitation Code: ${inviteCode}

Note: This single-use setup link and invitation code are strictly intended for setting up the initial owner account.
  `.trim()

  try {
    const message = new MailerMessage({
      from: {
        address: senderAddress,
        name: senderName
      },
      to: [
        {
          address: ownerEmail
        }
      ],
      subject: 'Atoll Chat - Complete Initial Owner Setup',
      html: htmlContent,
      text: textContent
    })

    e.app.newMailClient().send(message)
    e.app.logger().info(`[initial-invite] Setup invitation email dispatched to ${ownerEmail}`)
  } catch (err) {
    e.app.logger().error('[initial_invite.pb.js] Failed to dispatch setup email', 'error', err.message || String(err))
  }
})
