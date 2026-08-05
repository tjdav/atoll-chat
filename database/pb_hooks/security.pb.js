// database/pb_hooks/security.pb.js

/**
 * Dynamically hides encrypted vault keys from user payloads
 * unless the requester is the owner of the record.
 * Compatible with PocketBase v0.39.10+
 */
onRecordEnrich((e) => {
  let isOwner = false
  try {
    const info = typeof e.requestInfo === 'function' ? e.requestInfo() : (e.requestInfo || null)
    const authRecord = e.auth || (info ? (info.authRecord || info.auth) : null)
    isOwner = Boolean(authRecord && authRecord.id && authRecord.id === e.record.id)
  } catch (_err) {
    // ignore
  }

  // scrub the encrypted vault from payload if requester is guest or different user
  if (!isOwner) {
    e.record.hide('encrypted_master_keys')
    e.record.hide('encrypted_master_keys_passkey')
    e.record.hide('encrypted_private_keys')
    e.record.hide('recovery_wraps')
  }

  e.next()
}, 'users')
