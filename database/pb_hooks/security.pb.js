// database/pb_hooks/security.pb.js

/**
 * Dynamically hides encrypted vault keys from user payloads
 * unless the requester is the owner of the record.
 * Compatible with PocketBase v0.39.10+
 *
 * @param {core.RecordEnrichEvent} e - The PocketBase record enrichment event.
 * @returns {void}
 */
onRecordEnrich((e) => {
  let isOwner = false
  try {
    // Resolve info safely without nested ternaries
    let info = null
    if (e && typeof e.requestInfo === 'function') {
      info = e.requestInfo()
    } else if (e && e.requestInfo) {
      info = e.requestInfo
    }

    // Resolve authRecord safely
    let authRecord = null
    if (e && e.auth) {
      authRecord = e.auth
    } else if (info) {
      authRecord = info.authRecord || info.auth || null
    }

    isOwner = Boolean(e && e.record && authRecord && authRecord.id && authRecord.id === e.record.id)
  } catch (err) {
    // If an error occurs, log it rather than swallowing it, while ensuring isOwner remains false (fail closed).
    $app.logger().error('[onRecordEnrich] Failed to determine record ownership', 'error', err.message || String(err))
    isOwner = false
  }

  // scrub the encrypted vault from payload if requester is guest or different user
  if (!isOwner && e && e.record) {
    e.record.hide('encrypted_master_keys')
    e.record.hide('encrypted_master_keys_passkey')
    e.record.hide('encrypted_private_keys')
    e.record.hide('recovery_wraps')
  }

  if (e && typeof e.next === 'function') {
    e.next()
  }
}, 'users')
