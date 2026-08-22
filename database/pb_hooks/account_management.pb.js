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
