// database/pb_hooks/invitation_check.pb.js

/**
 * Hook executed before a request to create a user record.
 * Validates the presence of a valid, unused invitation code, ensures
 * the username is in lowercase, and initializes the profile display name.
 *
 * @param {core.RecordCreateEvent} e - The PocketBase record create event.
 * @throws {BadRequestError} If the invitation code is missing, invalid, expired, or already used.
 * @returns {void}
 */
onRecordCreateRequest((e) => {
  const info = e.requestInfo()

  // Superuser / System Bypass
  if (!info || e.hasSuperuserAuth()) {
    e.next()
    return
  }

  const username = e.record.get('username') || ''
  e.record.set('username', username.toLowerCase())

  // Ensure display name is initialized if empty
  if (!e.record.get('name')) {
    e.record.set('name', username)
  }

  // Extract invitation_code
  let invitationCode = ''
  if (info && info.data) {
    invitationCode = info.data.invitation_code || ''
  }

  if (!invitationCode) {
    throw new BadRequestError('Invitation code is required.')
  }

  // Query invitation non-throwingly using findRecordsByFilter
  const invitations = $app.findRecordsByFilter('invitations', 'code = {:code}', '', 1, 0, { code: invitationCode })
  if (invitations.length === 0) {
    throw new BadRequestError('Invalid or expired invitation code.')
  }

  const invitationRecord = invitations[0]

  if (invitationRecord.get('is_used')) {
    throw new BadRequestError('Invitation code has already been used.')
  }

  const expiresAt = invitationRecord.get('expires_at')
  if (expiresAt) {
    const expiresTime = new Date(expiresAt).getTime()
    if (expiresTime < Date.now()) {
      throw new BadRequestError('Invitation code has expired.')
    }
  }

  // Execute record creation
  e.next()

  // Phase 2: Atomic update on invitations after successful record creation
  if (invitationCode && e.record && e.record.id) {
    const updateResult = $app.db().newQuery(
      'UPDATE invitations SET is_used = 1, used_by = {:userId}, used_count = used_count + 1 WHERE code = {:code} AND is_used = 0'
    ).bind({
      code: invitationCode,
      userId: e.record.id
    }).execute()

    if (updateResult.rowsAffected() === 0) {
      // Rollback
      $app.delete(e.record)
      throw new BadRequestError('Invitation code was redeemed by another user.')
    }
  }
}, 'users')

/**
 * Hook executed before a request to update a user record.
 * Ensures that once created, the username field is immutable and cannot be altered.
 *
 * @param {core.RecordUpdateEvent} e - The PocketBase record update event.
 * @throws {BadRequestError} If an attempt is made to change the immutable username.
 * @returns {void}
 */
onRecordUpdateRequest((e) => {
  const info = e.requestInfo()

  // Superuser / System Bypass
  if (!info || e.hasSuperuserAuth()) {
    e.next()
    return
  }

  const newUsername = e.record.get('username')
  const originalRecord = e.originalRecord || (e.record && e.record.original ? e.record.original() : null)
  const originalUsername = originalRecord ? originalRecord.get('username') : ''

  if (newUsername && originalUsername && newUsername !== originalUsername) {
    throw new BadRequestError('Username is immutable and cannot be changed.')
  }

  e.next()
}, 'users')
