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

  /**
   * Parses a string representation of a boolean.
   *
   * @param {string|undefined} value - The string value.
   * @param {boolean} defaultValue - The default value to return if undefined.
   * @returns {boolean} The parsed boolean.
   */
  function parseBool (value, defaultValue = false) {
    if (value === undefined || value === '') {
      return defaultValue
    }
    return value === 'true' || value === '1'
  }

  const enabledEnv = getEnv('ATOLL_SMTP_ENABLED')
  const host = getEnv('ATOLL_SMTP_HOST')
  const portEnv = getEnv('ATOLL_SMTP_PORT')
  const username = getEnv('ATOLL_SMTP_USERNAME')
  const password = getEnv('ATOLL_SMTP_PASSWORD')
  const tlsEnv = getEnv('ATOLL_SMTP_TLS')
  const authMethod = getEnv('ATOLL_SMTP_AUTH_METHOD')
  const localName = getEnv('ATOLL_SMTP_LOCAL_NAME')
  const senderName = getEnv('ATOLL_SMTP_SENDER_NAME')
  const senderAddress = getEnv('ATOLL_SMTP_SENDER_ADDRESS')

  const hasSmtpConfig = enabledEnv !== undefined ||
                        host !== undefined ||
                        portEnv !== undefined ||
                        username !== undefined ||
                        password !== undefined ||
                        tlsEnv !== undefined ||
                        authMethod !== undefined ||
                        localName !== undefined ||
                        senderName !== undefined ||
                        senderAddress !== undefined

  if (!hasSmtpConfig) {
    return
  }

  // Fetch the current application settings
  const settings = e.app.settings()

  // Configure SMTP settings
  const smtp = settings.smtp
  if (smtp) {
    if (enabledEnv !== undefined) {
      smtp.enabled = parseBool(enabledEnv)
    } else if (host) {
      // Default to enabled if host is provided but enabled is not explicitly set
      smtp.enabled = true
    }

    if (host !== undefined) {
      smtp.host = host
    }
    if (portEnv !== undefined) {
      smtp.port = parseInt(portEnv, 10) || 587
    }
    if (username !== undefined) {
      smtp.username = username
    }
    if (password !== undefined) {
      smtp.password = password
    }
    if (tlsEnv !== undefined) {
      smtp.tls = parseBool(tlsEnv)
    }
    if (authMethod !== undefined) {
      smtp.authMethod = authMethod
    }
    if (localName !== undefined) {
      smtp.localName = localName
    }
  }

  // Configure the sender profile in metadata
  const meta = settings.meta
  if (meta) {
    if (senderName !== undefined) {
      meta.senderName = senderName
    } else if (!meta.senderName) {
      meta.senderName = 'Atoll Chat'
    }

    if (senderAddress !== undefined) {
      meta.senderAddress = senderAddress
    } else if (!meta.senderAddress) {
      meta.senderAddress = 'noreply@atoll.chat'
    }
  }

  // Commit the changes safely to the database
  e.app.save(settings)
})
