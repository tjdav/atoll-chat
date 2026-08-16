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
      const val = $os.getenv(key)
      return val !== '' ? val : undefined
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

  // Configure SMTP settings
  const smtp = settings.smtp || {}
  const enabledEnv = getEnv('ATOLL_SMTP_ENABLED')
  smtp.enabled = enabledEnv !== 'false'
  smtp.host = host

  const port = parseInt(getEnv('ATOLL_SMTP_PORT'), 10) || 587
  smtp.port = port
  smtp.username = getEnv('ATOLL_SMTP_USERNAME') || ''
  smtp.password = getEnv('ATOLL_SMTP_PASSWORD') || ''

  const tlsEnv = getEnv('ATOLL_SMTP_TLS')
  let tls = false
  if (tlsEnv !== undefined && tlsEnv !== '') {
    tls = tlsEnv === 'true'
  } else if (port === 465 || port === 2465) {
    tls = true
  }
  smtp.tls = tls

  smtp.authMethod = getEnv('ATOLL_SMTP_AUTH_METHOD') || 'PLAIN'
  smtp.localName = getEnv('ATOLL_SMTP_LOCAL_NAME') || ''
  settings.smtp = smtp

  // Configure the sender profile
  const meta = settings.meta || {}
  meta.senderName = getEnv('ATOLL_SMTP_SENDER_NAME') || 'Atoll Chat'
  meta.senderAddress = getEnv('ATOLL_SMTP_SENDER_ADDRESS') || 'noreply@atoll.chat'
  settings.meta = meta

  // Commit the changes safely to the database
  e.app.save(settings)
  try {
    if (typeof e.app.reloadSettings === 'function') {
      e.app.reloadSettings()
    }
  } catch (_err) {
    // Ignore if reloadSettings fails
  }
})
