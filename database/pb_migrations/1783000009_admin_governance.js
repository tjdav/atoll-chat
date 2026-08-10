migrate((app) => {
  const users = app.findCollectionByNameOrId('users')

  // Extend app_metadata collection
  const appMetadata = app.findCollectionByNameOrId('app_metadata')
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
  }

  // Create user_trust collection
  let userTrust
  try {
    userTrust = app.findCollectionByNameOrId('user_trust')
  } catch {
    userTrust = new Collection({ id: 'user_trust' })
  }

  userTrust.name = 'user_trust'
  userTrust.type = 'base'
  userTrust.listRule = null
  userTrust.viewRule = null
  userTrust.createRule = null
  userTrust.updateRule = null
  userTrust.deleteRule = null

  if (!userTrust.fields.getByName('user')) {
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
      required: true,
      min: 0,
      noDecimal: true
    }))
  }

  if (!userTrust.fields.getByName('invited_by')) {
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

  // Create invite_requests collection
  let inviteRequests
  try {
    inviteRequests = app.findCollectionByNameOrId('invite_requests')
  } catch {
    inviteRequests = new Collection({ id: 'invite_requests' })
  }

  inviteRequests.name = 'invite_requests'
  inviteRequests.type = 'base'
  inviteRequests.listRule = null
  inviteRequests.viewRule = null
  inviteRequests.createRule = '@request.auth.id != ""'
  inviteRequests.updateRule = null
  inviteRequests.deleteRule = null

  if (!inviteRequests.fields.getByName('requester')) {
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
  // rollback logic
  const userTrust = app.findCollectionByNameOrId('user_trust')
  if (userTrust) {
    app.delete(userTrust)
  }

  const inviteRequests = app.findCollectionByNameOrId('invite_requests')
  if (inviteRequests) {
    app.delete(inviteRequests)
  }

  const appMetadata = app.findCollectionByNameOrId('app_metadata')
  if (appMetadata) {
    appMetadata.fields.removeByName('invite_mode')
    appMetadata.fields.removeByName('default_trusted_quota')
    appMetadata.fields.removeByName('max_uses_per_invite')
    appMetadata.fields.removeByName('allow_quota_requests')
    app.save(appMetadata)
  }
})
