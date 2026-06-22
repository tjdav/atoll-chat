/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId('room_members')
  const messages = app.findCollectionByNameOrId('messages')

  collection.fields.add(new RelationField({
    name: 'last_read_message_id',
    required: false,
    maxSelect: 1,
    collectionId: messages.id,
    cascadeDelete: false,
    help: 'The ID of the last message this user has seen in this room.'
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('room_members')
  const field = collection.fields.getByName('last_read_message_id')
  if (field) {
    collection.fields.remove(field)
  }

  return app.save(collection)
})
