// database/pb_hooks/app_metadata.pb.js

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

  try {
    let collection
    try {
      collection = e.app.findCollectionByNameOrId('app_metadata')
    } catch {
      console.log('[app_metadata.pb.js] Collection app_metadata not found during bootstrap (expected on first-run before migrations). Skipping.')
      return
    }

    let records = []
    try {
      // Check if any record exists in app_metadata
      records = e.app.findRecordsByFilter('app_metadata', '1=1', '', 1, 0)
    } catch {
      records = []
    }

    if (!records || records.length === 0) {
      console.log('[app_metadata.pb.js] Initializing app metadata singleton...')
      const record = new Record(collection)

      const instanceId = getEnv('ATOLL_INSTANCE_ID') || $security.randomString(32)
      const appName = getEnv('ATOLL_APP_NAME') || 'Atoll Chat'
      const appUrl = getEnv('ATOLL_APP_URL') || 'http://localhost:3000'

      record.set('instance_id', instanceId)
      record.set('app_name', appName)
      record.set('app_url', appUrl)

      e.app.save(record)
      console.log('[app_metadata.pb.js] App metadata initialized with instance_id:', instanceId)
    } else {
      console.log('[app_metadata.pb.js] App metadata already exists. Active instance_id:', records[0].get('instance_id'))
    }
  } catch (err) {
    console.error('[app_metadata.pb.js] Failed to initialize app metadata:', err.message || err)
  }
})
