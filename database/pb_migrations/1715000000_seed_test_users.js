/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const usersCollection = app.findCollectionByNameOrId('users')
  const testUsers = ['alice@example.com', 'bob@example.com', 'charlie@example.com']

  for (const email of testUsers) {
    try {
      app.findAuthRecordByEmail('users', email)
    } catch (error) {
      const record = new Record(usersCollection)
      
      // Direct record property access
      record.set('email', email)
      record.setPassword('password123')
      record.set('emailVisibility', true)
      record.set('verified', true)
      
      app.save(record)
    }
  }
}, (app) => {
  const testUsers = ['alice@example.com', 'bob@example.com', 'charlie@example.com']
  for (const email of testUsers) {
    try {
      const record = app.findAuthRecordByEmail('users', email)
      app.delete(record)
    } catch (error) {
    }
  }
})
