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
    const f = rooms.fields.getByName('theme')
    if (f) {
      rooms.fields.remove(f)
      app.save(rooms)
    }
  }

  const roomMembers = app.findCollectionByNameOrId('room_members')
  if (roomMembers) {
    const f = roomMembers.fields.getByName('settings')
    if (f) {
      roomMembers.fields.remove(f)
      app.save(roomMembers)
    }
  }

  const users = app.findCollectionByNameOrId('users')
  if (users) {
    const f = users.fields.getByName('blocked_users')
    if (f) {
      users.fields.remove(f)
      app.save(users)
    }
  }
})
