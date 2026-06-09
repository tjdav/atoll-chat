migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  // Make PIN fields optional as passkey is an alternative
  const encryptedMasterKeys = collection.fields.getByName('encrypted_master_keys')
  if (encryptedMasterKeys) {
    encryptedMasterKeys.required = false
  }

  const pinSalt = collection.fields.getByName('pin_salt')
  if (pinSalt) {
    pinSalt.required = false
  }

  // Add passkey specific fields
  collection.fields.add(new TextField({
    name: 'passkey_prf_salt'
  }))

  collection.fields.add(new JSONField({
    name: 'encrypted_master_keys_passkey'
  }))

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('users')

  const encryptedMasterKeys = collection.fields.getByName('encrypted_master_keys')
  if (encryptedMasterKeys) {
    encryptedMasterKeys.required = true
  }

  const pinSalt = collection.fields.getByName('pin_salt')
  if (pinSalt) {
    pinSalt.required = true
  }

  collection.fields.removeByName('passkey_prf_salt')
  collection.fields.removeByName('encrypted_master_keys_passkey')

  app.save(collection)
})
