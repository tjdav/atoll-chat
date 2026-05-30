/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const rooms = new Collection({
    name: 'rooms',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""'
  })

  rooms.fields.add(new core.BoolField({
    name: 'is_group',
    required: true,
    help: 'True if it\'s a multi-user group chat, false for a standard 1-to-1 conversation.'
  }))

  rooms.fields.add(new core.TextField({
    name: 'encrypted_metadata',
    required: true,
    help: 'Stores the symmetrically encrypted JSON containing the group\'s name and avatar URL.'
  }))

  app.save(rooms)

  const users = app.findCollectionByNameOrId('users')

  const roomMembers = new Collection({
    name: 'room_members',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    indexes: [
      'CREATE UNIQUE INDEX idx_room_user ON room_members (room_id, user_id)'
    ]
  })

  roomMembers.fields.add(new core.RelationField({
    name: 'room_id',
    required: true,
    maxSelect: 1,
    collectionId: rooms.id,
    cascadeDelete: true
  }))

  roomMembers.fields.add(new core.RelationField({
    name: 'user_id',
    required: true,
    maxSelect: 1,
    collectionId: users.id,
    cascadeDelete: true,
    help: 'The member receiving the access key.'
  }))

  roomMembers.fields.add(new core.RelationField({
    name: 'wrapped_by',
    required: true,
    maxSelect: 1,
    collectionId: users.id,
    cascadeDelete: false,
    help: 'The ID of the user who invited this member and wrapped the key. The client uses this to know whose public key to verify against.'
  }))

  roomMembers.fields.add(new core.TextField({
    name: 'encrypted_room_key',
    required: true,
    help: 'The base64-encoded 32-byte shared Room Key, encrypted specifically for the user_id using Libsodium.'
  }))

  roomMembers.fields.add(new core.TextField({
    name: 'key_nonce',
    required: true
  }))

  roomMembers.fields.add(new core.SelectField({
    name: 'role',
    required: true,
    maxSelect: 1,
    values: ['member', 'admin', 'kicked']
  }))

  app.save(roomMembers)
}, (app) => {
  const roomMembers = app.findCollectionByNameOrId('room_members')
  if (roomMembers) {
    app.delete(roomMembers)
  }

  const rooms = app.findCollectionByNameOrId('rooms')
  if (rooms) {
    app.delete(rooms)
  }
})
