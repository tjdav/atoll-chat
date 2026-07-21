migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  collection.fields.add(new JSONField({
    name: 'encrypted_private_keys',
    required: false
  }))

  collection.fields.add(new JSONField({
    name: 'recovery_wraps',
    required: false
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('users')

  const encryptedPrivateKeys = collection.fields.getByName('encrypted_private_keys')
  if (encryptedPrivateKeys) {
    collection.fields.remove(encryptedPrivateKeys)
  }

  const recoveryWraps = collection.fields.getByName('recovery_wraps')
  if (recoveryWraps) {
    collection.fields.remove(recoveryWraps)
  }

  return app.save(collection)
})
