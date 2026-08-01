migrate((app) => {
  const users = app.findCollectionByNameOrId('users')

  let collection
  try {
    collection = app.findCollectionByNameOrId('invitations')
  } catch {
    collection = new Collection({ id: 'invitations' })
  }

  collection.name = 'invitations'
  collection.type = 'base'
  collection.listRule = null
  collection.viewRule = null
  collection.createRule = null
  collection.updateRule = null
  collection.deleteRule = null

  if (!collection.fields.getByName('code')) {
    collection.fields.add(new TextField({
      name: 'code',
      required: true,
      unique: true
    }))
  }

  if (!collection.fields.getByName('is_used')) {
    collection.fields.add(new BoolField({
      name: 'is_used',
      required: false
    }))
  }

  if (!collection.fields.getByName('used_by')) {
    collection.fields.add(new RelationField({
      name: 'used_by',
      required: false,
      collectionId: users.id,
      cascadeDelete: false,
      maxSelect: 1
    }))
  }

  if (!collection.fields.getByName('expires_at')) {
    collection.fields.add(new DateField({
      name: 'expires_at',
      required: false
    }))
  }

  if (!collection.fields.getByName('max_uses')) {
    collection.fields.add(new NumberField({
      name: 'max_uses',
      required: false,
      noDecimal: true
    }))
  }

  if (!collection.fields.getByName('used_count')) {
    collection.fields.add(new NumberField({
      name: 'used_count',
      required: false,
      noDecimal: true
    }))
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('invitations')
  if (collection) {
    return app.delete(collection)
  }
})
