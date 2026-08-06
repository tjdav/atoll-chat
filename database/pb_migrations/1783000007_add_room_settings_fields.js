/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Add "theme" field to rooms collection
  const rooms = app.findCollectionByNameOrId('rooms')
  if (rooms && !rooms.fields.getByName('theme')) {
    rooms.fields.add(new TextField({
      name: 'theme',
      required: false,
      help: 'Theme of the room (e.g. classic, ocean, forest, sunset)'
    }))
    app.save(rooms)
  }

  // Add "settings" JSON field to room_members collection
  const roomMembers = app.findCollectionByNameOrId('room_members')
  if (roomMembers && !roomMembers.fields.getByName('settings')) {
    roomMembers.fields.add(new JSONField({
      name: 'settings',
      required: false,
      help: 'Encrypted user-specific settings (nicknames, read receipts, etc.)'
    }))
    app.save(roomMembers)
  }

  // Add "blocked_users" JSON field to users collection
  const users = app.findCollectionByNameOrId('users')
  if (users && !users.fields.getByName('blocked_users')) {
    users.fields.add(new JSONField({
      name: 'blocked_users',
      required: false,
      help: 'JSON array of blocked user IDs'
    }))
    app.save(users)
  }
}, (app) => {
  // Rollback logic
  const rooms = app.findCollectionByNameOrId('rooms')
  if (rooms) {
    rooms.fields.removeByName('theme')
    app.save(rooms)
  }

  const roomMembers = app.findCollectionByNameOrId('room_members')
  if (roomMembers) {
    roomMembers.fields.removeByName('settings')
    app.save(roomMembers)
  }

  const users = app.findCollectionByNameOrId('users')
  if (users) {
    users.fields.removeByName('blocked_users')
    app.save(users)
  }
})
