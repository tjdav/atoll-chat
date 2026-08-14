migrate((app) => {
  // Safely find 'users' collection
  let users = null
  try {
    users = app.findCollectionByNameOrId('users')
  } catch (_err) {
    // 'users' collection does not exist yet
  }

  // Safely find and extend 'app_metadata' collection
  let appMetadata = null
  try {
    appMetadata = app.findCollectionByNameOrId('app_metadata')
  } catch (_err) {
    // 'app_metadata' collection does not exist yet
  }

  if (appMetadata) {
    if (!appMetadata.fields.getByName('invite_mode')) {
      appMetadata.fields.add(new SelectField({
        name: 'invite_mode',
        required: true,
        values: ['strict', 'delegated', 'open'],
        maxSelect: 1
      }))
    }
    if (!appMetadata.fields.getByName('default_trusted_quota')) {
      appMetadata.fields.add(new NumberField({
        name: 'default_trusted_quota',
        required: true,
        noDecimal: true
      }))
    }
    if (!appMetadata.fields.getByName('max_uses_per_invite')) {
      appMetadata.fields.add(new NumberField({
        name: 'max_uses_per_invite',
        required: true,
        noDecimal: true
      }))
    }
    if (!appMetadata.fields.getByName('allow_quota_requests')) {
      appMetadata.fields.add(new BoolField({
        name: 'allow_quota_requests',
        required: false
      }))
    }
    app.save(appMetadata)

    // Update existing singleton record with defaults
    try {
      const records = app.findRecordsByFilter('app_metadata', '1=1', '', 1, 0)
      if (records && records.length > 0) {
        const rec = records[0]
        if (!rec.get('invite_mode')) {
          rec.set('invite_mode', 'delegated')
        }
        if (rec.get('default_trusted_quota') === undefined || rec.get('default_trusted_quota') === null || rec.get('default_trusted_quota') === 0) {
          rec.set('default_trusted_quota', 5)
        }
        if (rec.get('max_uses_per_invite') === undefined || rec.get('max_uses_per_invite') === null || rec.get('max_uses_per_invite') === 0) {
          rec.set('max_uses_per_invite', 3)
        }
        if (rec.get('allow_quota_requests') === undefined || rec.get('allow_quota_requests') === null) {
          rec.set('allow_quota_requests', true)
        }
        app.save(rec)
      }
    } catch (_err) {
      // No records found or table query failed
    }
  }

  // Create or update 'user_trust' collection
  let userTrust = null
  try {
    userTrust = app.findCollectionByNameOrId('user_trust')
  } catch (_err) {
    userTrust = new Collection({ name: 'user_trust' })
  }

  userTrust.type = 'base'
  userTrust.listRule = '@request.auth.id != ""'
  userTrust.viewRule = '@request.auth.id != ""'
  userTrust.createRule = null
  userTrust.updateRule = null
  userTrust.deleteRule = null

  if (!userTrust.fields.getByName('user') && users) {
    userTrust.fields.add(new RelationField({
      name: 'user',
      required: true,
      unique: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1
    }))
  }

  if (!userTrust.fields.getByName('tier')) {
    userTrust.fields.add(new SelectField({
      name: 'tier',
      required: true,
      values: ['owner', 'trusted', 'standard'],
      maxSelect: 1
    }))
  }

  if (!userTrust.fields.getByName('invite_quota')) {
    userTrust.fields.add(new NumberField({
      name: 'invite_quota',
      required: false,
      min: 0,
      noDecimal: true
    }))
  }

  if (!userTrust.fields.getByName('invited_by') && users) {
    userTrust.fields.add(new RelationField({
      name: 'invited_by',
      required: false,
      collectionId: users.id,
      cascadeDelete: false,
      maxSelect: 1
    }))
  }

  if (!userTrust.fields.getByName('invites_revoked')) {
    userTrust.fields.add(new BoolField({
      name: 'invites_revoked',
      required: false
    }))
  }

  app.save(userTrust)

  // Create or update 'invite_requests' collection
  let inviteRequests = null
  try {
    inviteRequests = app.findCollectionByNameOrId('invite_requests')
  } catch (_err) {
    inviteRequests = new Collection({ name: 'invite_requests' })
  }

  inviteRequests.type = 'base'
  inviteRequests.listRule = '@request.auth.id != ""'
  inviteRequests.viewRule = '@request.auth.id != ""'
  inviteRequests.createRule = '@request.auth.id != ""'
  inviteRequests.updateRule = null
  inviteRequests.deleteRule = null

  if (!inviteRequests.fields.getByName('requester') && users) {
    inviteRequests.fields.add(new RelationField({
      name: 'requester',
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1
    }))
  }

  if (!inviteRequests.fields.getByName('requested_count')) {
    inviteRequests.fields.add(new NumberField({
      name: 'requested_count',
      required: true,
      min: 1,
      max: 10,
      noDecimal: true
    }))
  }

  if (!inviteRequests.fields.getByName('encrypted_reason')) {
    inviteRequests.fields.add(new TextField({
      name: 'encrypted_reason',
      required: true
    }))
  }

  if (!inviteRequests.fields.getByName('status')) {
    inviteRequests.fields.add(new SelectField({
      name: 'status',
      required: true,
      values: ['pending', 'approved', 'rejected'],
      maxSelect: 1
    }))
  }

  app.save(inviteRequests)
}, (app) => {
  // Rollback logic
  try {
    const userTrust = app.findCollectionByNameOrId('user_trust')
    if (userTrust) {
      app.delete(userTrust)
    }
  } catch (_err) {
  }

  try {
    const inviteRequests = app.findCollectionByNameOrId('invite_requests')
    if (inviteRequests) {
      app.delete(inviteRequests)
    }
  } catch (_err) {
  }

  try {
    const appMetadata = app.findCollectionByNameOrId('app_metadata')
    if (appMetadata) {
      appMetadata.fields.removeByName('invite_mode')
      appMetadata.fields.removeByName('default_trusted_quota')
      appMetadata.fields.removeByName('max_uses_per_invite')
      appMetadata.fields.removeByName('allow_quota_requests')
      app.save(appMetadata)
    }
  } catch (_err) {
  }
})
