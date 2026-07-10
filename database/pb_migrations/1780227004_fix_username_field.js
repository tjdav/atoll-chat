migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  // add the username field if it doesn't exist
  if (!collection.fields.getByName('username')) {
    collection.fields.add(new TextField({
      name: 'username',
      required: true,
      min: 3,
      max: 20,
      pattern: '^[a-zA-Z0-9_]+$'
    }))
  }

  // add unique index
  if (!collection.indexes) {
    collection.indexes = []
  }
  const hasIndex = collection.indexes.some(idx => idx.includes('idx_username_unique'))
  if (!hasIndex) {
    collection.indexes.push('CREATE UNIQUE INDEX `idx_username_unique` ON `users` (`username`)')
  }

  // save schema changes
  app.save(collection)

  // enable it as identity field
  const updatedCollection = app.findCollectionByNameOrId('users')
  if (!updatedCollection.passwordAuth.identityFields.includes('username')) {
    updatedCollection.passwordAuth.identityFields = ['email', 'username']
    app.save(updatedCollection)
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId('users')

  collection.passwordAuth.identityFields = ['email']
  app.save(collection)

  const updatedCollection = app.findCollectionByNameOrId('users')
  updatedCollection.fields.removeByName('username')
  if (updatedCollection.indexes) {
    updatedCollection.indexes = updatedCollection.indexes.filter(idx => !idx.includes('idx_username_unique'))
  }
  app.save(updatedCollection)
})
