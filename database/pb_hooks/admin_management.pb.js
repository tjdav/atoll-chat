// database/pb_hooks/admin_management.pb.js

/**
 * Counts rows in a collection table.
 *
 * Genuine database failures propagate so callers fail closed instead of
 * silently defaulting to zero.
 *
 * @param {string} table - The name of the database table/collection.
 * @param {import("dbx").Expression} [condition] - Optional query condition filter.
 * @returns {number} The count of matching rows.
 */
function countTable (table, condition) {
  const dm = new DynamicModel({ count: 0 })
  let query = $app.db().select('count(*) as count').from(table)
  if (condition) {
    query = query.where(condition)
  }
  query.one(dm)
  return dm.count
}

/**
 * Loads the singleton `app_metadata` record or fails with a clear error.
 *
 * @throws {BadRequestError} If no `app_metadata` record exists.
 * @returns {core.Record} The fetched metadata record.
 */
function getAppMetadata () {
  const records = $app.findRecordsByFilter('app_metadata', '1=1', '', 1, 0)
  if (records.length === 0) {
    throw new BadRequestError('App metadata record not found.')
  }
  return records[0]
}

/**
 * Returns the trust record for the given user, lazy-seeding it when absent.
 *
 * The first account ever created is promoted to owner; database failures
 * propagate so ownership is never granted by accident (fail closed).
 *
 * @param {string} userId - The unique ID of the target user record.
 * @returns {core.Record} The existing or freshly created `user_trust` record.
 */
function getOrCreateTrust (userId) {
  const existing = $app.findRecordsByFilter('user_trust', 'user = {:userId}', '', 1, 0, { userId: userId })
  if (existing.length > 0) {
    return existing[0]
  }

  const firstUsers = $app.findRecordsByFilter('users', '1=1', 'created', 1, 0)
  const isFirst = firstUsers.length > 0 && firstUsers[0].id === userId
  const collection = $app.findCollectionByNameOrId('user_trust')
  const trustRecord = new Record(collection)
  trustRecord.set('user', userId)
  trustRecord.set('tier', isFirst ? 'owner' : 'standard')
  trustRecord.set('invite_quota', isFirst ? 999999 : 0)
  trustRecord.set('invites_revoked', false)
  $app.save(trustRecord)
  return trustRecord
}

/**
 * Middleware helper that ensures the requesting user has the owner tier in `user_trust`.
 *
 * @param {core.RequestEvent} e - The PocketBase router context event object.
 * @throws {ForbiddenError} If the request is unauthenticated or the user lacks the owner tier.
 * @returns {void}
 */
function enforceOwner (e) {
  const authRecord = e.auth
  if (!authRecord) {
    throw new ForbiddenError('Only authenticated owners can access this endpoint.')
  }

  const trust = getOrCreateTrust(authRecord.id)
  if (trust.get('tier') !== 'owner') {
    throw new ForbiddenError('Only authenticated owners can access this endpoint.')
  }
}

// GET /api/custom/admin/overview
routerAdd('GET', '/api/custom/admin/overview', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      throw new ForbiddenError('Authentication is required.')
    }

    const appMetadataRecord = getAppMetadata()
    const totalUsers = countTable('users')
    const activeRooms = countTable('rooms')
    const activeInvitations = countTable('invitations', $dbx.exp('is_used = 0'))
    const pendingInviteRequests = countTable('invite_requests', $dbx.exp('status = {:status}', { status: 'pending' }))

    return e.json(200, {
      metadata: {
        invite_mode: appMetadataRecord.get('invite_mode') || 'delegated',
        default_trusted_quota: appMetadataRecord.get('default_trusted_quota') || 5,
        max_uses_per_invite: appMetadataRecord.get('max_uses_per_invite') || 3,
        allow_quota_requests: appMetadataRecord.get('allow_quota_requests') !== false
      },
      stats: {
        totalUsers: totalUsers,
        activeRooms: activeRooms,
        pendingInviteRequests: pendingInviteRequests,
        activeInvitations: activeInvitations
      }
    })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

// POST /api/custom/admin/settings
routerAdd('POST', '/api/custom/admin/settings', (e) => {
  try {
    enforceOwner(e)

    const data = new DynamicModel({
      invite_mode: '',
      default_trusted_quota: null,
      max_uses_per_invite: null,
      allow_quota_requests: null
    })
    e.bindBody(data)

    const appMetadataRecord = getAppMetadata()

    if (data.invite_mode) {
      if (!['strict', 'delegated', 'open'].includes(data.invite_mode)) {
        throw new BadRequestError('Invalid invite_mode value.')
      }
      appMetadataRecord.set('invite_mode', data.invite_mode)
    }
    if (data.default_trusted_quota !== null) {
      appMetadataRecord.set('default_trusted_quota', parseInt(data.default_trusted_quota, 10))
    }
    if (data.max_uses_per_invite !== null) {
      appMetadataRecord.set('max_uses_per_invite', parseInt(data.max_uses_per_invite, 10))
    }
    if (data.allow_quota_requests !== null) {
      appMetadataRecord.set('allow_quota_requests', !!data.allow_quota_requests)
    }

    $app.save(appMetadataRecord)

    return e.json(200, { success: true })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

// POST /api/custom/admin/users/trust
routerAdd('POST', '/api/custom/admin/users/trust', (e) => {
  try {
    enforceOwner(e)

    const data = new DynamicModel({
      userId: '',
      tier: '',
      invite_quota: null,
      invites_revoked: null
    })
    e.bindBody(data)

    if (!data.userId) {
      throw new BadRequestError('Missing userId parameter.')
    }

    const targetUsers = $app.findRecordsByIds('users', [data.userId])
    if (targetUsers.length === 0) {
      throw new BadRequestError('Target user does not exist.')
    }

    const trustRecord = getOrCreateTrust(data.userId)

    if (data.tier) {
      if (!['owner', 'trusted', 'standard'].includes(data.tier)) {
        throw new BadRequestError('Invalid tier value.')
      }
      trustRecord.set('tier', data.tier)
    }
    if (data.invite_quota !== null) {
      trustRecord.set('invite_quota', parseInt(data.invite_quota, 10))
    }
    if (data.invites_revoked !== null) {
      trustRecord.set('invites_revoked', !!data.invites_revoked)
    }

    $app.save(trustRecord)

    return e.json(200, { success: true })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

// POST /api/custom/admin/requests/resolve
routerAdd('POST', '/api/custom/admin/requests/resolve', (e) => {
  try {
    enforceOwner(e)

    const data = new DynamicModel({
      requestId: '',
      status: ''
    })
    e.bindBody(data)

    if (!data.requestId || !data.status) {
      throw new BadRequestError('Missing requestId or status parameters.')
    }

    if (!['approved', 'rejected'].includes(data.status)) {
      throw new BadRequestError('Status must be approved or rejected.')
    }

    const requestRecords = $app.findRecordsByIds('invite_requests', [data.requestId])
    if (requestRecords.length === 0) {
      throw new BadRequestError('Invite request not found.')
    }
    const requestRecord = requestRecords[0]

    if (requestRecord.get('status') !== 'pending') {
      throw new BadRequestError('Invite request has already been resolved.')
    }

    const requesterId = requestRecord.get('requester')
    const requestedCount = requestRecord.get('requested_count') || 0

    // Execute the resolution inside a transaction
    $app.runInTransaction((txApp) => {
      requestRecord.set('status', data.status)
      txApp.save(requestRecord)

      if (data.status === 'approved') {
        const trustRecords = txApp.findRecordsByFilter('user_trust', 'user = {:userId}', '', 1, 0, { userId: requesterId })
        let trustRecord
        if (trustRecords.length > 0) {
          trustRecord = trustRecords[0]
        } else {
          const collection = txApp.findCollectionByNameOrId('user_trust')
          trustRecord = new Record(collection)
          trustRecord.set('user', requesterId)
          trustRecord.set('tier', 'standard')
          trustRecord.set('invite_quota', 0)
          trustRecord.set('invites_revoked', false)
        }

        const currentQuota = trustRecord.get('invite_quota') || 0
        trustRecord.set('invite_quota', currentQuota + requestedCount)
        txApp.save(trustRecord)
      }

      return null
    })

    return e.json(200, { success: true })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

// GET /api/custom/owner/public-key
routerAdd('GET', '/api/custom/owner/public-key', (e) => {
  try {
    if (!e.auth) {
      throw new ForbiddenError('Authentication is required.')
    }

    let ownerTrust
    const owners = $app.findRecordsByFilter('user_trust', 'tier = "owner"', '', 1, 0)
    if (owners.length > 0) {
      ownerTrust = owners[0]
    } else {
      const firstUsers = $app.findRecordsByFilter('users', '1=1', 'created', 1, 0)
      if (firstUsers.length === 0) {
        throw new BadRequestError('No owner or users found on this instance.')
      }
      ownerTrust = getOrCreateTrust(firstUsers[0].id)
    }

    const ownerRecords = $app.findRecordsByIds('users', [ownerTrust.get('user')])
    if (ownerRecords.length === 0) {
      throw new BadRequestError('Owner user record not found.')
    }

    return e.json(200, {
      ownerPublicKey: ownerRecords[0].get('public_box_key') || ''
    })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

// POST /api/custom/invites/generate
routerAdd('POST', '/api/custom/invites/generate', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      throw new ForbiddenError('Authentication is required.')
    }

    const appMetadataRecord = getAppMetadata()

    const inviteMode = appMetadataRecord.get('invite_mode') || 'delegated'
    const maxUses = appMetadataRecord.get('max_uses_per_invite') || 3

    const trustRecord = getOrCreateTrust(authRecord.id)

    const isOwner = trustRecord.get('tier') === 'owner'
    const isRevoked = !!trustRecord.get('invites_revoked')
    const currentQuota = trustRecord.get('invite_quota') || 0

    if (isRevoked) {
      throw new ForbiddenError('Your invite generation privileges have been revoked.')
    }

    if (inviteMode === 'strict' && !isOwner) {
      throw new ForbiddenError('Invite generation is restricted to the instance owner.')
    }

    if (!isOwner && currentQuota <= 0) {
      throw new ForbiddenError('You do not have enough invite quota remaining.')
    }

    // Atomically deduct quota if the requester is not the owner
    if (!isOwner) {
      trustRecord.set('invite_quota', currentQuota - 1)
      $app.save(trustRecord)
    }

    function randSeg (len) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      let res = ''
      for (let i = 0; i < len; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return res
    }
    const code = `INV-${randSeg(4)}-${randSeg(4)}`

    const invitationsColl = $app.findCollectionByNameOrId('invitations')
    const inviteRecord = new Record(invitationsColl)
    inviteRecord.set('code', code)
    inviteRecord.set('is_used', false)
    inviteRecord.set('max_uses', maxUses)
    inviteRecord.set('used_count', 0)
    $app.save(inviteRecord)

    return e.json(200, {
      code: code,
      max_uses: maxUses
    })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

// POST /api/custom/invites/request
routerAdd('POST', '/api/custom/invites/request', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      throw new ForbiddenError('Authentication is required.')
    }

    const data = new DynamicModel({
      requested_count: 1,
      encrypted_reason: ''
    })
    e.bindBody(data)

    if (!data.encrypted_reason) {
      throw new BadRequestError('Missing encrypted reason parameter.')
    }

    const requestedCount = parseInt(data.requested_count, 10)
    if (isNaN(requestedCount) || requestedCount < 1 || requestedCount > 10) {
      throw new BadRequestError('Requested count must be between 1 and 10.')
    }

    const appMetadataRecord = getAppMetadata()

    if (appMetadataRecord.get('allow_quota_requests') === false) {
      throw new ForbiddenError('Quota requests are disabled on this instance.')
    }

    const inviteRequestsColl = $app.findCollectionByNameOrId('invite_requests')
    const requestRecord = new Record(inviteRequestsColl)
    requestRecord.set('requester', authRecord.id)
    requestRecord.set('requested_count', requestedCount)
    requestRecord.set('encrypted_reason', data.encrypted_reason)
    requestRecord.set('status', 'pending')

    $app.save(requestRecord)

    return e.json(200, { success: true })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})
