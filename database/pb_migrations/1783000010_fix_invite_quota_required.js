migrate((app) => {
  const collections = app.findAllCollections()
  const userTrust = collections.find((c) => c.name === 'user_trust' || c.id === 'user_trust')
  if (userTrust) {
    const inviteQuotaField = userTrust.fields.getByName('invite_quota')
    if (inviteQuotaField && inviteQuotaField.required) {
      inviteQuotaField.required = false
      app.save(userTrust)
    }
  }
}, (app) => {
  // rollback is not strictly necessary for this schema fix
})
