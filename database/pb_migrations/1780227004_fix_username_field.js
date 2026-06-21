migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  // 1. Add the username field
  collection.fields.add(new TextField({
    name: 'username',
    required: true,
    min: 3,
    max: 20,
    pattern: '^[a-zA-Z0-9_]+$'
  }))

  // 2. Explicitly add a unique index to satisfy identityFields requirement
  if (!collection.indexes) {
    collection.indexes = []
  }
  collection.indexes.push('CREATE UNIQUE INDEX `idx_username_unique` ON `users` (`username`)')

  // Save the schema changes first
  app.save(collection)

  // 3. Enable it as an identity field
  const updatedCollection = app.findCollectionByNameOrId('users')
  updatedCollection.passwordAuth.identityFields = ['email', 'username']

  app.save(updatedCollection)
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
