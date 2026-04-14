/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const users = app.findCollectionByNameOrId('users')

  users.fields.add(new TextField({
    name: 'public_box_key'
  }))
  users.fields.add(new TextField({
    name: 'public_sign_key'
  }))
  users.fields.add(new JSONField({
    name: 'encrypted_master_keys'
  }))
  users.fields.add(new TextField({
    name: 'pin_salt'
  }))
  users.fields.add(new TextField({
    name: 'passkey_credential_id'
  }))

  app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId('users')

  users.fields.removeByName('public_box_key')
  users.fields.removeByName('public_sign_key')
  users.fields.removeByName('encrypted_master_keys')
  users.fields.removeByName('pin_salt')
  users.fields.removeByName('passkey_credential_id')

  app.save(users)
})
