migrate((app) => {
  try {
    const userTrust = app.findCollectionByNameOrId('user_trust')
    const inviteQuotaField = userTrust.fields.getByName('invite_quota')
    if (inviteQuotaField && inviteQuotaField.required) {
      inviteQuotaField.required = false
      app.save(userTrust)
    }
  } catch (_err) {
    // collection doesn't exist yet or update failed
  }
}, (app) => {
  // rollback is not strictly necessary for this schema fix
})
