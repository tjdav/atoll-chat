// database/pb_hooks/admin_management.pb.js

/**
 * GET /api/custom/admin/overview
 * Returns instance governance settings and high-level platform statistics.
 */
routerAdd('GET', '/api/custom/admin/overview', (e) => {
  try {
    const { countTable, getAppMetadata } = require(`${__hooks}/admin_helpers.js`)

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
        totalUsers,
        activeRooms,
        pendingInviteRequests,
        activeInvitations
      }
    })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

/**
 * GET /api/custom/invites/list
 * Returns the list of invitation codes for the authenticated user.
 * If the user is an owner, they get all codes. If a standard user, only their own codes.
 */
routerAdd('GET', '/api/custom/invites/list', (e) => {
  try {
    const { getOrCreateTrust } = require(`${__hooks}/admin_helpers.js`)

    const authRecord = e.auth
    if (!authRecord) {
      throw new ForbiddenError('Authentication is required.')
    }

    const trustRecord = getOrCreateTrust(authRecord.id)
    const isOwner = trustRecord.get('tier') === 'owner'

    let invitations = []
    if (isOwner) {
      invitations = $app.findRecordsByFilter('invitations', '1=1', '-created', 100, 0)
    } else {
      invitations = $app.findRecordsByFilter('invitations', 'created_by = {:userId}', '-created', 100, 0, { userId: authRecord.id })
    }

    const userIds = []
    invitations.forEach((inv) => {
      const usedBy = inv.get('used_by')
      if (usedBy) {
        userIds.push(usedBy)
      }
    })

    const usersMap = {}
    if (userIds.length > 0) {
      const userRecords = $app.findRecordsByIds('users', userIds)
      userRecords.forEach((userRec) => {
        usersMap[userRec.id] = {
          id: userRec.id,
          username: userRec.get('username'),
          name: userRec.get('name')
        }
      })
    }

    const results = invitations.map((inv) => {
      const usedByUserId = inv.get('used_by')
      const usedByUser = usedByUserId ? (usersMap[usedByUserId] || null) : null

      return {
        id: inv.id,
        code: inv.get('code'),
        is_used: inv.get('is_used') || false,
        max_uses: inv.get('max_uses') || 3,
        used_count: inv.get('used_count') || 0,
        expires_at: inv.get('expires_at') || null,
        used_by: usedByUser,
        created: inv.get('created')
      }
    })

    return e.json(200, results)
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

/**
 * POST /api/custom/admin/settings
 * Updates global instance governance metadata.
 */
routerAdd('POST', '/api/custom/admin/settings', (e) => {
  try {
    const { enforceOwner, getAppMetadata } = require(`${__hooks}/admin_helpers.js`)
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

/**
 * POST /api/custom/admin/users/trust
 * Updates a user's trust tier, quota, or privileges.
 */
routerAdd('POST', '/api/custom/admin/users/trust', (e) => {
  try {
    const { enforceOwner, getOrCreateTrust } = require(`${__hooks}/admin_helpers.js`)
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

/**
 * POST /api/custom/admin/requests/resolve
 * Approves or rejects a pending invite request and grants quota if approved.
 */
routerAdd('POST', '/api/custom/admin/requests/resolve', (e) => {
  try {
    const { enforceOwner } = require(`${__hooks}/admin_helpers.js`)
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

/**
 * GET /api/custom/owner/public-key
 * Returns the public box encryption key of the instance owner.
 */
routerAdd('GET', '/api/custom/owner/public-key', (e) => {
  try {
    const { getOrCreateTrust } = require(`${__hooks}/admin_helpers.js`)

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

/**
 * POST /api/custom/invites/generate
 * Generates an invitation code for an authorized owner or quota-credited member.
 */
routerAdd('POST', '/api/custom/invites/generate', (e) => {
  try {
    const { getAppMetadata, getOrCreateTrust } = require(`${__hooks}/admin_helpers.js`)

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
    inviteRecord.set('created_by', authRecord.id)
    $app.save(inviteRecord)

    return e.json(200, {
      code,
      max_uses: maxUses
    })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

/**
 * POST /api/custom/invites/request
 * Submits a zero-knowledge encrypted quota request for owner review.
 */
routerAdd('POST', '/api/custom/invites/request', (e) => {
  try {
    const { getAppMetadata } = require(`${__hooks}/admin_helpers.js`)

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
