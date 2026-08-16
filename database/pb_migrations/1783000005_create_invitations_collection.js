migrate((app) => {
  const collections = app.findAllCollections()
  const users = collections.find((c) => c.name === 'users' || c.id === 'users')

  let collection = collections.find((c) => c.name === 'invitations' || c.id === 'invitations')
  if (!collection) {
    collection = new Collection({ name: 'invitations' })
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

  if (!collection.fields.getByName('created')) {
    collection.fields.add(new AutodateField({
      name: 'created',
      onCreate: true,
      onUpdate: false
    }))
  }

  if (!collection.fields.getByName('updated')) {
    collection.fields.add(new AutodateField({
      name: 'updated',
      onCreate: true,
      onUpdate: true
    }))
  }

  return app.save(collection)
}, (app) => {
  const collections = app.findAllCollections()
  const collection = collections.find((c) => c.name === 'invitations' || c.id === 'invitations')
  if (collection) {
    return app.delete(collection)
  }
})
