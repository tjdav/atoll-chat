// database/pb_hooks/smtp_config.pb.js

onBootstrap((e) => {
  e.next()

  /**
   * Retrieves the value of the environment variable named by the key.
   *
   * @param {string} key - The environment variable name.
   * @returns {string|undefined} The environment variable value or undefined if not present.
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

  // Check if the SMTP Host variable exists before attempting to apply
  const host = getEnv('ATOLL_SMTP_HOST')
  if (!host) {
    return
  }

  // Fetch the current application settings
  const settings = e.app.settings()

  // Apply the EU-strict routing and credentials
  const smtp = settings.smtp || settings.SMTP
  if (smtp) {
    if (smtp.enabled !== undefined) {
      smtp.enabled = true
      smtp.host = host
      smtp.port = parseInt(getEnv('ATOLL_SMTP_PORT'), 10) || 587
      smtp.username = getEnv('ATOLL_SMTP_USERNAME') || ''
      smtp.password = getEnv('ATOLL_SMTP_PASSWORD') || ''
    } else {
      smtp.Enabled = true
      smtp.Host = host
      smtp.Port = parseInt(getEnv('ATOLL_SMTP_PORT'), 10) || 587
      smtp.Username = getEnv('ATOLL_SMTP_USERNAME') || ''
      smtp.Password = getEnv('ATOLL_SMTP_PASSWORD') || ''
    }
  }

  // Configure the sender profile
  const meta = settings.meta || settings.Meta
  if (meta) {
    if (meta.senderName !== undefined) {
      meta.senderName = getEnv('ATOLL_SMTP_SENDER_NAME') || 'Atoll Chat'
      meta.senderAddress = getEnv('ATOLL_SMTP_SENDER_ADDRESS') || 'noreply@atoll.chat'
    } else {
      meta.SenderName = getEnv('ATOLL_SMTP_SENDER_NAME') || 'Atoll Chat'
      meta.SenderAddress = getEnv('ATOLL_SMTP_SENDER_ADDRESS') || 'noreply@atoll.chat'
    }
  }

  // Commit the changes safely to the database
  e.app.save(settings)
})
