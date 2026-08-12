/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const rooms = app.findCollectionByNameOrId('rooms')
  const users = app.findCollectionByNameOrId('users')
  const messages = app.findCollectionByNameOrId('messages')

  // Create room_settings collection
  let settingsCollection
  try {
    settingsCollection = app.findCollectionByNameOrId('room_settings')
  } catch {
    settingsCollection = new Collection({ name: 'room_settings' })
  }
  settingsCollection.name = 'room_settings'
  settingsCollection.type = 'base'
  settingsCollection.listRule = '@request.auth.id != "" && user_id = @request.auth.id'
  settingsCollection.viewRule = '@request.auth.id != "" && user_id = @request.auth.id'
  settingsCollection.createRule = '@request.auth.id != "" && user_id = @request.auth.id'
  settingsCollection.updateRule = '@request.auth.id != "" && user_id = @request.auth.id'
  settingsCollection.deleteRule = '@request.auth.id != "" && user_id = @request.auth.id'
  settingsCollection.indexes = [
    'CREATE UNIQUE INDEX idx_room_settings_user_room ON room_settings (room_id, user_id)'
  ]

  if (!settingsCollection.fields.getByName('room_id')) {
    settingsCollection.fields.add(new RelationField({
      name: 'room_id',
      required: true,
      collectionId: rooms.id,
      cascadeDelete: true,
      maxSelect: 1
    }))
  }
  if (!settingsCollection.fields.getByName('user_id')) {
    settingsCollection.fields.add(new RelationField({
      name: 'user_id',
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1
    }))
  }
  if (!settingsCollection.fields.getByName('is_muted')) {
    settingsCollection.fields.add(new BoolField({
      name: 'is_muted',
      required: false
    }))
  }
  if (!settingsCollection.fields.getByName('settings')) {
    settingsCollection.fields.add(new JSONField({
      name: 'settings',
      required: false
    }))
  }
  app.save(settingsCollection)

  // Create room_member_states collection
  let statesCollection
  try {
    statesCollection = app.findCollectionByNameOrId('room_member_states')
  } catch {
    statesCollection = new Collection({ name: 'room_member_states' })
  }
  statesCollection.name = 'room_member_states'
  statesCollection.type = 'base'
  statesCollection.listRule = '@request.auth.id != "" && room_id.room_members_via_room_id.user_id ?= @request.auth.id'
  statesCollection.viewRule = '@request.auth.id != "" && room_id.room_members_via_room_id.user_id ?= @request.auth.id'
  statesCollection.createRule = '@request.auth.id != "" && user_id = @request.auth.id'
  statesCollection.updateRule = '@request.auth.id != "" && user_id = @request.auth.id'
  statesCollection.deleteRule = '@request.auth.id != "" && user_id = @request.auth.id'
  statesCollection.indexes = [
    'CREATE UNIQUE INDEX idx_room_member_states_user_room ON room_member_states (room_id, user_id)'
  ]

  if (!statesCollection.fields.getByName('room_id')) {
    statesCollection.fields.add(new RelationField({
      name: 'room_id',
      required: true,
      collectionId: rooms.id,
      cascadeDelete: true,
      maxSelect: 1
    }))
  }
  if (!statesCollection.fields.getByName('user_id')) {
    statesCollection.fields.add(new RelationField({
      name: 'user_id',
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1
    }))
  }
  if (!statesCollection.fields.getByName('last_read_message_id')) {
    statesCollection.fields.add(new RelationField({
      name: 'last_read_message_id',
      required: false,
      collectionId: messages.id,
      cascadeDelete: false,
      maxSelect: 1
    }))
  }
  if (!statesCollection.fields.getByName('is_typing')) {
    statesCollection.fields.add(new BoolField({
      name: 'is_typing',
      required: false
    }))
  }
  app.save(statesCollection)

  // Remove is_muted, settings, last_read_message_id fields from room_members
  const roomMembers = app.findCollectionByNameOrId('room_members')
  if (roomMembers) {
    roomMembers.fields.removeByName('is_muted')
    roomMembers.fields.removeByName('settings')
    roomMembers.fields.removeByName('last_read_message_id')
    app.save(roomMembers)
  }
}, (app) => {
  // Rollback logic
  try {
    const settingsCollection = app.findCollectionByNameOrId('room_settings')
    if (settingsCollection) {
      app.delete(settingsCollection)
    }
  } catch {
  }

  try {
    const statesCollection = app.findCollectionByNameOrId('room_member_states')
    if (statesCollection) {
      app.delete(statesCollection)
    }
  } catch {
  }

  const roomMembers = app.findCollectionByNameOrId('room_members')
  if (roomMembers) {
    const messages = app.findCollectionByNameOrId('messages')
    if (!roomMembers.fields.getByName('is_muted')) {
      roomMembers.fields.add(new BoolField({
        name: 'is_muted',
        required: false
      }))
    }
    if (!roomMembers.fields.getByName('settings')) {
      roomMembers.fields.add(new JSONField({
        name: 'settings',
        required: false
      }))
    }
    if (!roomMembers.fields.getByName('last_read_message_id') && messages) {
      roomMembers.fields.add(new RelationField({
        name: 'last_read_message_id',
        required: false,
        collectionId: messages.id,
        cascadeDelete: false,
        maxSelect: 1
      }))
    }
    app.save(roomMembers)
  }
})
