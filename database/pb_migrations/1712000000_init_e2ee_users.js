migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  // update username constraints
  const usernameField = collection.fields.getByName('username')
  if (usernameField) {
    usernameField.unique = true
    usernameField.min = 3
    usernameField.max = 20
    usernameField.pattern = '^[a-zA-Z0-9_]+$'
  }

  // public key fields
  collection.fields.add(new TextField({
    name: 'public_box_key',
    required: true
  }))

  collection.fields.add(new TextField({
    name: 'public_sign_key',
    required: true
  }))

  // zero-knowledge vault
  collection.fields.add(new JSONField({
    name: 'encrypted_master_keys',
    required: true
  }))

  // key derivation & auth fields
  collection.fields.add(new TextField({
    name: 'pin_salt',
    required: true
  }))

  collection.fields.add(new TextField({
    name: 'passkey_credential_id'
  }))

  // api rules visibility
  collection.listRule = ''
  collection.viewRule = ''
  collection.updateRule = 'id = @request.auth.id'
  collection.deleteRule = 'id = @request.auth.id'

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('users')

  // Remove added fields
  collection.fields.removeByName('public_box_key')
  collection.fields.removeByName('public_sign_key')
  collection.fields.removeByName('encrypted_master_keys')
  collection.fields.removeByName('pin_salt')
  collection.fields.removeByName('passkey_credential_id')

  // Reset username constraints
  const usernameField = collection.fields.getByName('username')
  if (usernameField) {
    usernameField.min = null
    usernameField.max = null
    usernameField.pattern = ''
  }

  // Reset rules to authenticated only
  collection.listRule = 'id = @request.auth.id'
  collection.viewRule = 'id = @request.auth.id'
  collection.updateRule = 'id = @request.auth.id'
  collection.deleteRule = 'id = @request.auth.id'

  app.save(collection)
})
