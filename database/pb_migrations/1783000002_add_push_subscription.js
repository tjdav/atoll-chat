migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  collection.fields.add(new JSONField({
    name: 'push_subscription',
    required: false
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('users')
  const field = collection.fields.getByName('push_subscription')
  if (field) {
    collection.fields.remove(field)
  }

  return app.save(collection)
})
