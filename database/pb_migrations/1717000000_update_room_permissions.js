/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Update rooms collection
  const rooms = app.findCollectionByNameOrId('rooms')
  rooms.listRule = '@request.auth.id != ""'
  rooms.viewRule = '@request.auth.id != ""'
  rooms.createRule = '@request.auth.id != ""'
  rooms.updateRule = '@request.auth.id != ""'
  rooms.deleteRule = '@request.auth.id != ""'
  app.save(rooms)

  // Update room_members collection
  const roomMembers = app.findCollectionByNameOrId('room_members')
  roomMembers.listRule = '@request.auth.id != ""'
  roomMembers.viewRule = '@request.auth.id != ""'
  roomMembers.createRule = '@request.auth.id != ""'
  roomMembers.updateRule = '@request.auth.id != ""'
  roomMembers.deleteRule = '@request.auth.id != ""'
  app.save(roomMembers)

  // Update messages collection
  const messages = app.findCollectionByNameOrId('messages')
  messages.listRule = '@request.auth.id != ""'
  messages.viewRule = '@request.auth.id != ""'
  messages.createRule = '@request.auth.id != ""'
  messages.updateRule = '@request.auth.id != ""'
  messages.deleteRule = '@request.auth.id != ""'
  app.save(messages)

  // Update room_user_roles collection
  const roomUserRoles = app.findCollectionByNameOrId('room_user_roles')
  roomUserRoles.listRule = '@request.auth.id != ""'
  roomUserRoles.viewRule = '@request.auth.id != ""'
  roomUserRoles.createRule = '@request.auth.id != ""'
  roomUserRoles.updateRule = '@request.auth.id != ""'
  roomUserRoles.deleteRule = '@request.auth.id != ""'
  app.save(roomUserRoles)

  // Update room_roles collection
  const roomRoles = app.findCollectionByNameOrId('room_roles')
  roomRoles.listRule = '@request.auth.id != ""'
  roomRoles.viewRule = '@request.auth.id != ""'
  app.save(roomRoles)
}, (app) => {
  // Revert to empty/previous rules if needed
  const collections = ['rooms', 'room_members', 'messages', 'room_user_roles', 'room_roles']
  collections.forEach(name => {
    const col = app.findCollectionByNameOrId(name)
    if (col) {
      if (name === 'room_user_roles' || name === 'room_roles') {
        col.listRule = '@request.auth.id != ""'
        col.viewRule = '@request.auth.id != ""'
        col.createRule = '@request.auth.id != ""'
        col.updateRule = '@request.auth.id != ""'
        col.deleteRule = '@request.auth.id != ""'
      } else {
        col.listRule = ''
        col.viewRule = ''
        col.createRule = ''
        col.updateRule = ''
        col.deleteRule = ''
      }
      app.save(col)
    }
  })
})
