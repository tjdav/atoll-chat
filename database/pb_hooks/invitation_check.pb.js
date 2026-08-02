// pb_hooks/invitation_check.pb.js

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

  const invitationRecord = new DynamicModel({
    id: '',
    is_used: false,
    expires_at: ''
  })

  try {
    $app.db()
      .select('id', 'is_used', 'expires_at')
      .from('invitations')
      .where($dbx.hashExp({ code: invitationCode }))
      .limit(1)
      .one(invitationRecord)
  } catch (_err) {
    throw new BadRequestError('Invalid or expired invitation code.')
  }

  if (invitationRecord.is_used) {
    throw new BadRequestError('Invitation code has already been used.')
  }

  if (invitationRecord.expires_at) {
    const expiresTime = new Date(invitationRecord.expires_at).getTime()
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
