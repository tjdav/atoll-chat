/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // 1. Create Superuser
  const superusers = app.findCollectionByNameOrId('_superusers')
  const admin = new Record(superusers)
  admin.set('email', 'admin@example.com')
  admin.set('password', 'password123')
  app.save(admin)

  // 2. Create Users
  const users = app.findCollectionByNameOrId('users')

  const alice = new Record(users)
  alice.set('email', 'alice@example.com')
  alice.set('password', 'password123')
  app.save(alice)

  const bob = new Record(users)
  bob.set('email', 'bob@example.com')
  bob.set('password', 'password123')
  app.save(bob)

  const charlie = new Record(users)
  charlie.set('email', 'charlie@example.com')
  charlie.set('password', 'password123')
  app.save(charlie)

}, (app) => {
  try {
    const admin = app.findAuthRecordByEmail('_superusers', 'admin@example.com')
    app.delete(admin)
  } catch {
  }

  try {
    const alice = app.findAuthRecordByEmail('users', 'alice@example.com')
    app.delete(alice)
  } catch {
  }

  try {
    const bob = app.findAuthRecordByEmail('users', 'bob@example.com')
    app.delete(bob)
  } catch {
  }

  try {
    const charlie = app.findAuthRecordByEmail('users', 'charlie@example.com')
    app.delete(charlie)
  } catch {
  }
})
