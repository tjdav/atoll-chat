// pb_hooks/security.pb.js

/**
 * Dynamically hides the encrypted master keys from user payloads
 * unless the requester is the owner of the record.
 */
onRecordEnrich((e) => {
  let isOwner = false
  try {
    const info = e.requestInfo()
    isOwner = info && info.auth && info.auth.id === e.record.id
  } catch (_err) {
    // ignore
  }

  // scrub the encrypted vault from payload if requester is guest or different user
  if (!isOwner) {
    e.record.hide('encrypted_master_keys')
  }

  e.next()
}, 'users')
