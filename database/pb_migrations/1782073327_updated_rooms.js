/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId('pbc_3085411453')

  // update field
  collection.fields.addAt(1, new Field({
    help: "True if it's a multi-user group chat, false for a standard 1-to-1 conversation.",
    hidden: false,
    id: 'bool557623221',
    name: 'is_group',
    presentable: false,
    required: false,
    system: false,
    type: 'bool'
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('pbc_3085411453')

  // update field
  collection.fields.addAt(1, new Field({
    help: "True if it's a multi-user group chat, false for a standard 1-to-1 conversation.",
    hidden: false,
    id: 'bool557623221',
    name: 'is_group',
    presentable: false,
    required: true,
    system: false,
    type: 'bool'
  }))

  return app.save(collection)
})
