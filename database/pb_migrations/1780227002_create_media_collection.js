/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  let media
  try {
    media = app.findCollectionByNameOrId('pbc_2708086759')
  } catch (err) {
    media = new Collection({ id: 'pbc_2708086759' })
  }

  media.name = 'media'
  media.type = 'base'
  media.listRule = '@request.auth.id != ""'
  media.viewRule = '@request.auth.id != ""'
  media.createRule = '@request.auth.id != ""'
  media.updateRule = null
  media.deleteRule = null

  if (!media.fields.getByName('file')) {
    media.fields.add(new FileField({
      name: 'file',
      required: true,
      maxSelect: 1,
      maxSize: 31457280
    }))
  }

  if (!media.fields.getByName('created')) {
    media.fields.add(new AutodateField({
      name: 'created',
      onCreate: true
    }))
  }

  if (!media.fields.getByName('updated')) {
    media.fields.add(new AutodateField({
      name: 'updated',
      onCreate: true,
      onUpdate: true
    }))
  }

  app.save(media)
}, (app) => {
  const media = app.findCollectionByNameOrId('media')
  if (media) {
    app.delete(media)
  }
})
