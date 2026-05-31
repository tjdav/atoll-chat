/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const media = new Collection({
    name: 'media',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: null,
    deleteRule: null
  })

  media.fields.add(new core.FileField({
    name: 'file',
    required: true,
    maxSelect: 1,
    maxSize: 31457280
  }))

  app.save(media)
}, (app) => {
  const media = app.findCollectionByNameOrId('media')
  if (media) {
    app.delete(media)
  }
})
