// database/pb_hooks/server_metadata.pb.js

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
    const collection = e.app.findCollectionByNameOrId('server_metadata')
    let records = []

    try {
      // Check if any record exists in server_metadata
      records = e.app.findRecordsByFilter('server_metadata', '1=1', '', 1, 0)
    } catch {
      records = []
    }

    if (!records || records.length === 0) {
      console.log('[server_metadata.pb.js] Initializing server metadata singleton...')
      const record = new Record(collection)

      const instanceId = $security.randomString(32)
      const appName = 'Atoll Chat'
      const appUrl = getEnv('ATOLL_APP_URL') || 'http://localhost:3000'

      record.set('instance_id', instanceId)
      record.set('app_name', appName)
      record.set('app_url', appUrl)

      e.app.save(record)
      console.log('[server_metadata.pb.js] Server metadata initialized with instance_id:', instanceId)
    } else {
      console.log('[server_metadata.pb.js] Server metadata already exists. Active instance_id:', records[0].get('instance_id'))
    }
  } catch (err) {
    console.error('[server_metadata.pb.js] Failed to initialize server metadata:', err.message || err)
  }
})
