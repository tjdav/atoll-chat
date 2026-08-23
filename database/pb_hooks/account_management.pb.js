// database/pb_hooks/account_management.pb.js

/**
 * POST /api/custom/history/delete
 *
 * Permanently deletes all messages and associated media sent by the authenticated user
 * across all rooms from the PocketBase server.
 *
 * @param {Object} e - The PocketBase router context event object.
 * @returns {void}
 */
routerAdd('POST', '/api/custom/history/delete', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      throw new ForbiddenError('Authentication is required.')
    }

    const data = new DynamicModel({
      password: ''
    })
    e.bindBody(data)

    if (!data.password) {
      throw new BadRequestError('Password is required.')
    }

    const validPassword = authRecord.validatePassword(data.password)
    if (!validPassword) {
      throw new BadRequestError('Invalid password.')
    }

    const userId = authRecord.id

    $app.runInTransaction((txApp) => {
      // 1. Delete media records linked to user's messages
      txApp.db().newQuery(
        'DELETE FROM media WHERE id IN (SELECT media_id FROM messages WHERE sender_id = {:userId})'
      ).bind({ userId }).execute()

      // 2. Delete all messages sent by the user
      txApp.db().newQuery(
        'DELETE FROM messages WHERE sender_id = {:userId}'
      ).bind({ userId }).execute()

      return null
    })

    return e.json(200, {
      success: true,
      message: 'Message history deleted successfully.'
    })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})

/**
 * POST /api/custom/account/export
 *
 * Compiles and returns server-side GDPR personal data archive for the authenticated user.
 *
 * @param {Object} e - The PocketBase router context event object.
 * @returns {void}
 */
routerAdd('POST', '/api/custom/account/export', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      throw new ForbiddenError('Authentication is required.')
    }

    const data = new DynamicModel({
      password: ''
    })
    e.bindBody(data)

    if (!data.password) {
      throw new BadRequestError('Password is required.')
    }

    const validPassword = authRecord.validatePassword(data.password)
    if (!validPassword) {
      throw new BadRequestError('Invalid password.')
    }

    const userId = authRecord.id

    // User profile
    const userProfile = {
      id: authRecord.id,
      username: authRecord.get('username') || '',
      email: authRecord.get('email') || '',
      name: authRecord.get('name') || '',
      avatar: authRecord.get('avatar') || '',
      created: authRecord.get('created') || null,
      updated: authRecord.get('updated') || null
    }

    // Cryptographic credentials (strictly public metadata only)
    const cryptographicCredentials = {
      public_box_key: authRecord.get('public_box_key') || '',
      public_sign_key: authRecord.get('public_sign_key') || '',
      vault_salt: authRecord.get('vault_salt') || '',
      passkey_credential_id: authRecord.get('passkey_credential_id') || null,
      passkey_public_key: authRecord.get('passkey_public_key') || null,
      passkey_counter: authRecord.get('passkey_counter') || 0
    }

    // Trust and governance
    let trustAndGovernance = null
    const trustRecords = $app.findRecordsByFilter('user_trust', 'user = {:userId}', '', 1, 0, { userId })
    if (trustRecords.length > 0) {
      const tr = trustRecords[0]
      trustAndGovernance = {
        tier: tr.get('tier'),
        invite_quota: tr.get('invite_quota'),
        invites_revoked: Boolean(tr.get('invites_revoked')),
        created: tr.get('created'),
        updated: tr.get('updated')
      }
    }

    // Rooms and memberships
    const roomMemberships = $app.findRecordsByFilter('room_members', 'user_id = {:userId}', '', 0, 0, { userId })
    const rooms = []
    for (const rm of roomMemberships) {
      const roomId = rm.get('room_id')
      let roomRecord = null
      try {
        roomRecord = $app.findRecordById('rooms', roomId)
      } catch (_) {
      }

      rooms.push({
        id: roomId,
        name: roomRecord ? roomRecord.get('name') : '',
        is_group: roomRecord ? Boolean(roomRecord.get('is_group')) : false,
        created_by: roomRecord ? roomRecord.get('created_by') : '',
        role: rm.get('role') || 'member',
        is_muted: Boolean(rm.get('is_muted')),
        last_seen_message_id: rm.get('last_seen_message_id') || null,
        last_seen_at: rm.get('last_seen_at') || null,
        custom_name: rm.get('custom_name') || '',
        theme: rm.get('theme') || '',
        is_pinned: Boolean(rm.get('is_pinned')),
        is_archived: Boolean(rm.get('is_archived')),
        draft: rm.get('draft') || '',
        created: roomRecord ? roomRecord.get('created') : null,
        updated: roomRecord ? roomRecord.get('updated') : null
      })
    }

    // Authored messages
    const messageRecords = $app.findRecordsByFilter('messages', 'sender_id = {:userId}', 'created', 0, 0, { userId })
    const authoredMessages = messageRecords.map((m) => ({
      id: m.id,
      room_id: m.get('room_id'),
      sender_id: m.get('sender_id'),
      epoch_id: m.get('epoch_id') || 0,
      previous_msg_uuid: m.get('previous_msg_uuid') || null,
      signature: m.get('signature') || '',
      media_id: m.get('media_id') || null,
      created: m.get('created'),
      updated: m.get('updated')
    }))

    // Authored media records
    const mediaRecordsList = $app.findRecordsByFilter('media', 'sender_id = {:userId}', 'created', 0, 0, { userId })
    const mediaRecords = mediaRecordsList.map((med) => ({
      id: med.id,
      file: med.get('file') || '',
      mime_type: med.get('mime_type') || '',
      size: med.get('size') || 0,
      created: med.get('created'),
      updated: med.get('updated')
    }))

    // Invitations
    const invitationsList = $app.findRecordsByFilter('invitations', 'created_by = {:userId}', 'created', 0, 0, { userId })
    const invitations = invitationsList.map((inv) => ({
      id: inv.id,
      code: inv.get('code'),
      is_used: Boolean(inv.get('is_used')),
      max_uses: inv.get('max_uses') || 1,
      used_count: inv.get('used_count') || 0,
      expires_at: inv.get('expires_at') || null,
      created: inv.get('created'),
      updated: inv.get('updated')
    }))

    // Invite requests
    const inviteRequestsList = $app.findRecordsByFilter('invite_requests', 'requester = {:userId}', 'created', 0, 0, { userId })
    const inviteRequests = inviteRequestsList.map((req) => ({
      id: req.id,
      status: req.get('status') || 'pending',
      reason: req.get('reason') || '',
      created: req.get('created'),
      updated: req.get('updated')
    }))

    return e.json(200, {
      success: true,
      export_version: '1.0',
      exported_at: new Date().toISOString(),
      offline_export: false,
      data: {
        user_profile: userProfile,
        cryptographic_credentials: cryptographicCredentials,
        trust_and_governance: trustAndGovernance,
        rooms: rooms,
        authored_messages: authoredMessages,
        media_records: mediaRecords,
        invitations: invitations,
        invite_requests: inviteRequests
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
 * POST /api/custom/account/delete
 *
 * Permanently deletes the authenticated user's account, room memberships, authored messages/media,
 * pending invite requests, invitations, and trust record.
 * If the user is an owner and other active users exist, promotes the next oldest user to owner.
 *
 * @param {Object} e - The PocketBase router context event object.
 * @returns {void}
 */
routerAdd('POST', '/api/custom/account/delete', (e) => {
  try {
    const authRecord = e.auth
    if (!authRecord) {
      throw new ForbiddenError('Authentication is required.')
    }

    const data = new DynamicModel({
      password: ''
    })
    e.bindBody(data)

    if (!data.password) {
      throw new BadRequestError('Password is required.')
    }

    const validPassword = authRecord.validatePassword(data.password)
    if (!validPassword) {
      throw new BadRequestError('Invalid password.')
    }

    const userId = authRecord.id

    $app.runInTransaction((txApp) => {
      // Check if deleting user is an owner
      let isOwner = false
      const trustList = txApp.findRecordsByFilter('user_trust', 'user = {:userId}', '', 1, 0, { userId })
      if (trustList.length > 0 && trustList[0].get('tier') === 'owner') {
        isOwner = true
      }

      // 1. Delete user's media and messages
      txApp.db().newQuery(
        'DELETE FROM media WHERE id IN (SELECT media_id FROM messages WHERE sender_id = {:userId})'
      ).bind({ userId }).execute()

      txApp.db().newQuery(
        'DELETE FROM messages WHERE sender_id = {:userId}'
      ).bind({ userId }).execute()

      // 2. Delete user's room memberships
      txApp.db().newQuery(
        'DELETE FROM room_members WHERE user_id = {:userId}'
      ).bind({ userId }).execute()

      // 3. Delete orphaned 1:1 rooms that no longer have active members
      txApp.db().newQuery(
        'DELETE FROM rooms WHERE (is_group = 0 OR is_group = false) AND id NOT IN (SELECT DISTINCT room_id FROM room_members)'
      ).execute()

      // 4. Delete pending invite requests created by the user
      txApp.db().newQuery(
        'DELETE FROM invite_requests WHERE requester = {:userId}'
      ).bind({ userId }).execute()

      // 5. Delete invitations created by the user
      txApp.db().newQuery(
        'DELETE FROM invitations WHERE created_by = {:userId}'
      ).bind({ userId }).execute()

      // 6. Delete user_trust record
      txApp.db().newQuery(
        'DELETE FROM user_trust WHERE user = {:userId}'
      ).bind({ userId }).execute()

      // 7. Delete the user record
      txApp.delete(authRecord)

      // 8. Handle owner promotion if deleting user was an owner
      if (isOwner) {
        const remainingUsers = txApp.findRecordsByFilter('users', 'id != {:userId}', 'created', 1, 0, { userId })
        if (remainingUsers.length > 0) {
          const nextOwner = remainingUsers[0]
          const nextOwnerTrustList = txApp.findRecordsByFilter('user_trust', 'user = {:userId}', '', 1, 0, { userId: nextOwner.id })
          let nextOwnerTrust
          if (nextOwnerTrustList.length > 0) {
            nextOwnerTrust = nextOwnerTrustList[0]
          } else {
            const trustColl = txApp.findCollectionByNameOrId('user_trust')
            nextOwnerTrust = new Record(trustColl)
            nextOwnerTrust.set('user', nextOwner.id)
          }
          nextOwnerTrust.set('tier', 'owner')
          nextOwnerTrust.set('invite_quota', 999999)
          txApp.save(nextOwnerTrust)
        }
      }

      return null
    })

    return e.json(200, {
      success: true,
      message: 'Account deleted successfully.'
    })
  } catch (err) {
    if (err.status) {
      throw err
    }
    throw new BadRequestError(err.message || String(err))
  }
})
