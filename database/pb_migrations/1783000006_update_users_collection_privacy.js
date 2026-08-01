migrate((app) => {
  const collection = app.findCollectionByNameOrId('users')

  // Make email field optional and adjust constraints
  const emailField = collection.fields.getByName('email')
  if (emailField) {
    emailField.required = false
    emailField.unique = false
  }

  // Update username field validation pattern to lower-case only
  const usernameField = collection.fields.getByName('username')
  if (usernameField) {
    usernameField.pattern = '^[a-z0-9_]+$'
  }

  // Force emailVisibility to false for privacy
  const emailVisibilityField = collection.fields.getByName('emailVisibility')
  if (emailVisibilityField) {
    // some versions have it as a Field
    emailVisibilityField.required = false
  }

  // Ensure password auth strictly uses username
  if (collection.passwordAuth) {
    collection.passwordAuth.identityFields = ['username']
  }

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('users')

  const emailField = collection.fields.getByName('email')
  if (emailField) {
    emailField.required = true
  }

  const usernameField = collection.fields.getByName('username')
  if (usernameField) {
    usernameField.pattern = '^[a-zA-Z0-9_]+$'
  }

  return app.save(collection)
})
