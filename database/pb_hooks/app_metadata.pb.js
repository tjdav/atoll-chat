// database/pb_hooks/app_metadata.pb.js

/**
 * Hook triggered during the PocketBase bootstrap process.
 * Initializes the app metadata singleton if it does not already exist.
 *
 * @param {core.BootstrapEvent} e - The PocketBase bootstrap event.
 * @throws {Error} If an unexpected database or system failure occurs during initialization.
 * @returns {void}
 */
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

  // Non-throwing collection existence check to avoid try/catch for control flow.
  const collections = e.app.findAllCollections()
  const collection = collections.find((c) => {
    const name = c.name || c.Name || (typeof c.get === 'function' ? c.get('name') : undefined)
    return name === 'app_metadata'
  })

  if (!collection) {
    e.app.logger().info('[app_metadata.pb.js] Collection app_metadata not found during bootstrap (expected on first-run before migrations). Skipping.')
    return
  }

  //  Querying the record. Since the collection exists, failures here are unexpected database issues.
  let records = []
  try {
    records = e.app.findRecordsByFilter('app_metadata', '1=1', '', 1, 0)
  } catch (err) {
    e.app.logger().error('[app_metadata.pb.js] Unexpected database error when querying app_metadata:', 'error', err.message || String(err))
    throw err
  }

  // Initializing singleton record if it doesn't exist
  if (!records || records.length === 0) {
    e.app.logger().info('[app_metadata.pb.js] Initializing app metadata singleton...')
    const record = new Record(collection)

    const instanceId = getEnv('ATOLL_INSTANCE_ID') || $security.randomString(32)
    const appName = getEnv('ATOLL_APP_NAME') || 'Atoll Chat'
    const appUrl = getEnv('ATOLL_APP_URL') || 'http://localhost:3000'

    record.set('instance_id', instanceId)
    record.set('app_name', appName)
    record.set('app_url', appUrl)

    if (collection.fields.getByName('invite_mode')) {
      record.set('invite_mode', 'delegated')
    }
    if (collection.fields.getByName('default_trusted_quota')) {
      record.set('default_trusted_quota', 5)
    }
    if (collection.fields.getByName('max_uses_per_invite')) {
      record.set('max_uses_per_invite', 3)
    }
    if (collection.fields.getByName('allow_quota_requests')) {
      record.set('allow_quota_requests', true)
    }

    try {
      e.app.save(record)
      e.app.logger().info('[app_metadata.pb.js] App metadata initialized with instance_id:', 'instance_id', instanceId)
    } catch (err) {
      e.app.logger().error('[app_metadata.pb.js] Failed to save initial app metadata record:', 'error', err.message || String(err))
      throw err
    }
  } else {
    e.app.logger().info('[app_metadata.pb.js] App metadata already exists. Active instance_id:', 'instance_id', records[0].get('instance_id'))
  }
})
