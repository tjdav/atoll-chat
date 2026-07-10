// pb_hooks/security.pb.js

/**
 * Dynamically hides the encrypted master keys from user payloads
 * unless the requester is the owner of the record.
 */
onRecordEnrich((e) => {
  // Check if the user making the request is the owner of this specific record
  const isOwner = e.requestInfo.auth && e.requestInfo.auth.id === e.record.id

  // scrub the encrypted vault from payload if requester is guest or different user
  if (!isOwner) {
    e.record.hide('encrypted_master_keys')
  }

  e.next()
}, 'users')
