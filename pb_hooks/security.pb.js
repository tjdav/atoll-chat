// pb_hooks/security.pb.js

/**
 * Dynamically hides the encrypted master keys from user payloads
 * unless the requester is the owner of the record.
 */
onRecordEnrich((e) => {
  // Check if the user making the request is the owner of this specific record
  const isOwner = e.requestInfo.auth && e.requestInfo.auth.id === e.record.id

  // If the requester is a guest or a DIFFERENT user, scrub the encrypted vault from the payload.
  // The pin_salt, public_box_key, and public_sign_key will remain visible.
  if (!isOwner) {
    e.record.hide('encrypted_master_keys')
  }

  e.next()
}, 'users')
