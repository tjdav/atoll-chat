/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const rooms = new Collection({
    name: 'rooms',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: '',
    fields: [
      new TextField({
        name: 'name',
        required: true
      }),
      new TextField({
        name: 'topic'
      })
    ]
  })
  app.save(rooms)

  const roomMembers = new Collection({
    name: 'room_members',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: '',
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: rooms.id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'user_id',
        collectionId: app.findCollectionByNameOrId('users').id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'invited_by',
        collectionId: app.findCollectionByNameOrId('users').id,
        cascadeDelete: false,
        required: true,
        maxSelect: 1
      }),
      new TextField({
        name: 'status'
      }),
      new TextField({
        name: 'encrypted_room_key'
      })
    ]
  })
  app.save(roomMembers)

  const messages = new Collection({
    name: 'messages',
    type: 'base',
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: '',
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: rooms.id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'sender_id',
        collectionId: app.findCollectionByNameOrId('users').id,
        cascadeDelete: true,
        required: true,
        maxSelect: 1
      }),
      new TextField({
        name: 'msgtype'
      }),
      new TextField({
        name: 'payload'
      })
    ]
  })
  app.save(messages)
}, (app) => {
  const messages = app.findCollectionByNameOrId('messages')
  app.delete(messages)
  
  const roomMembers = app.findCollectionByNameOrId('room_members')
  app.delete(roomMembers)
  
  const rooms = app.findCollectionByNameOrId('rooms')
  app.delete(rooms)
})
