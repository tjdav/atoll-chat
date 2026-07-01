migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  const pinSalt = collection.fields.getByName('pin_salt')
  if (pinSalt) {
    pinSalt.name = 'vault_salt'
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('users')

  const vaultSalt = collection.fields.getByName('vault_salt')
  if (vaultSalt) {
    vaultSalt.name = 'pin_salt'
  }

  return app.save(collection)
})
