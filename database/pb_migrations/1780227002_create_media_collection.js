/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const media = new Collection({
    id: 'pbc_2708086759',
    name: 'media',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: null,
    deleteRule: null
  })

  media.fields.add(new FileField({
    name: 'file',
    required: true,
    maxSelect: 1,
    maxSize: 31457280
  }))

  media.fields.add(new AutodateField({
    name: 'created',
    onCreate: true
  }))

  media.fields.add(new AutodateField({
    name: 'updated',
    onCreate: true,
    onUpdate: true
  }))

  app.save(media)
}, (app) => {
  const media = app.findCollectionByNameOrId('media')
  if (media) {
    app.delete(media)
  }
})
