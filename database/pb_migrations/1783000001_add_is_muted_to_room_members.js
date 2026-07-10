/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId('room_members')

  collection.fields.add(new BoolField({
    name: 'is_muted',
    required: false,
    help: 'True if the user has muted notifications for this room.'
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('room_members')
  const field = collection.fields.getByName('is_muted')
  if (field) {
    collection.fields.remove(field)
  }

  return app.save(collection)
})
