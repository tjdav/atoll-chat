/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const roomsCollection = app.findCollectionByNameOrId('rooms')
  const usersCollection = app.findCollectionByNameOrId('users')

  const roomRoles = new Collection({
    name: 'room_roles',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: roomsCollection.id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      }),
      new TextField({
        name: 'name',
        required: true
      })
    ]
  })
  app.save(roomRoles)

  const roomUserRoles = new Collection({
    name: 'room_user_roles',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: roomsCollection.id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'user_id',
        collectionId: usersCollection.id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'role_id',
        collectionId: roomRoles.id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      })
    ]
  })
  app.save(roomUserRoles)

}, (app) => {
  const roomUserRoles = app.findCollectionByNameOrId('room_user_roles')
  if (roomUserRoles) {
    app.delete(roomUserRoles)
  }

  const roomRoles = app.findCollectionByNameOrId('room_roles')
  if (roomRoles) {
    app.delete(roomRoles)
  }
})
