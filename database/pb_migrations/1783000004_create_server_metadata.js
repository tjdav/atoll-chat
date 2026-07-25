migrate((app) => {
  let serverMetadata
  try {
    serverMetadata = app.findCollectionByNameOrId('server_metadata')
  } catch {
    serverMetadata = new Collection({ id: 'server_metadata' })
  }

  serverMetadata.name = 'server_metadata'
  serverMetadata.type = 'base'
  serverMetadata.listRule = ''
  serverMetadata.viewRule = ''
  serverMetadata.createRule = null
  serverMetadata.updateRule = null
  serverMetadata.deleteRule = null

  if (!serverMetadata.fields.getByName('instance_id')) {
    serverMetadata.fields.add(new TextField({
      name: 'instance_id',
      required: true
    }))
  }

  if (!serverMetadata.fields.getByName('app_name')) {
    serverMetadata.fields.add(new TextField({
      name: 'app_name',
      required: true
    }))
  }

  if (!serverMetadata.fields.getByName('app_url')) {
    serverMetadata.fields.add(new TextField({
      name: 'app_url',
      required: true
    }))
  }

  return app.save(serverMetadata)
}, (app) => {
  const collection = app.findCollectionByNameOrId('server_metadata')
  if (collection) {
    return app.delete(collection)
  }
})
