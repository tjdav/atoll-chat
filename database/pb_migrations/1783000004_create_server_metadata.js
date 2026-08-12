migrate((app) => {
  let appMetadata
  try {
    appMetadata = app.findCollectionByNameOrId('app_metadata')
  } catch {
    appMetadata = new Collection({ name: 'app_metadata' })
  }

  appMetadata.name = 'app_metadata'
  appMetadata.type = 'base'
  appMetadata.listRule = ''
  appMetadata.viewRule = ''
  appMetadata.createRule = null
  appMetadata.updateRule = null
  appMetadata.deleteRule = null

  if (!appMetadata.fields.getByName('instance_id')) {
    appMetadata.fields.add(new TextField({
      name: 'instance_id',
      required: true
    }))
  }

  if (!appMetadata.fields.getByName('app_name')) {
    appMetadata.fields.add(new TextField({
      name: 'app_name',
      required: true
    }))
  }

  if (!appMetadata.fields.getByName('app_url')) {
    appMetadata.fields.add(new TextField({
      name: 'app_url',
      required: true
    }))
  }

  app.save(appMetadata)

  let records = []
  try {
    records = app.findRecordsByFilter('app_metadata', '1=1', '', 1, 0)
  } catch {
    records = []
  }

  if (!records || records.length === 0) {
    const record = new Record(appMetadata)

    function getEnv (key) {
      if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
        return process.env[key]
      }
      if (typeof $os !== 'undefined' && typeof $os.getenv === 'function') {
        return $os.getenv(key)
      }
      return undefined
    }

    const instanceId = getEnv('ATOLL_INSTANCE_ID') || $security.randomString(32)
    const appName = getEnv('ATOLL_APP_NAME') || 'Atoll Chat'
    const appUrl = getEnv('ATOLL_APP_URL') || 'http://localhost:3000'

    record.set('instance_id', instanceId)
    record.set('app_name', appName)
    record.set('app_url', appUrl)

    app.save(record)
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId('app_metadata')
  if (collection) {
    return app.delete(collection)
  }
})
