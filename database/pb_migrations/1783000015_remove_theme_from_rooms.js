/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collections = app.findAllCollections()
  const rooms = collections.find((c) => c.name === 'rooms' || c.id === 'rooms')
  if (rooms && rooms.fields.getByName('theme')) {
    rooms.fields.removeByName('theme')
    app.save(rooms)
  }
}, (app) => {
  const collections = app.findAllCollections()
  const rooms = collections.find((c) => c.name === 'rooms' || c.id === 'rooms')
  if (rooms && !rooms.fields.getByName('theme')) {
    rooms.fields.add(new TextField({
      name: 'theme',
      required: false
    }))
    app.save(rooms)
  }
})
