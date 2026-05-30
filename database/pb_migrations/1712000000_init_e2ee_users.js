migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  // 4. task: Constraints & Indexes - Update username constraints
  const usernameField = collection.fields.getByName('username')
  if (usernameField) {
    usernameField.unique = true
    usernameField.min = 3
    usernameField.max = 20
    usernameField.pattern = '^[a-zA-Z0-9_]+$'
  }

  // 1. task: Public Key Fields
  collection.fields.add(new core.TextField({
    name: 'public_box_key',
    required: true
  }))

  collection.fields.add(new core.TextField({
    name: 'public_sign_key',
    required: true
  }))

  // 2. task: The Zero-Knowledge Vault
  collection.fields.add(new core.JSONField({
    name: 'encrypted_master_keys',
    required: true
  }))

  // 3. task: Key Derivation & Auth Fields
  collection.fields.add(new core.TextField({
    name: 'pin_salt',
    required: true
  }))

  collection.fields.add(new core.TextField({
    name: 'passkey_credential_id'
  }))

  // API Rules (Visibility)
  // User requested "" (Leave empty) for List/Search & View to allow authenticated users to search.
  // Note: In PocketBase "" means public access.
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
