migrate((app) => {
  const collections = app.findAllCollections()

  const userTrust = collections.find((c) => (c.name || c.Name) === 'user_trust')
  if (userTrust) {
    userTrust.listRule = '@request.auth.id != ""'
    userTrust.viewRule = '@request.auth.id != ""'
    app.save(userTrust)
  }

  const inviteRequests = collections.find((c) => (c.name || c.Name) === 'invite_requests')
  if (inviteRequests) {
    inviteRequests.listRule = '@request.auth.id != ""'
    inviteRequests.viewRule = '@request.auth.id != ""'
    app.save(inviteRequests)
  }
}, (app) => {
  const collections = app.findAllCollections()

  const userTrust = collections.find((c) => (c.name || c.Name) === 'user_trust')
  if (userTrust) {
    userTrust.listRule = null
    userTrust.viewRule = null
    app.save(userTrust)
  }

  const inviteRequests = collections.find((c) => (c.name || c.Name) === 'invite_requests')
  if (inviteRequests) {
    inviteRequests.listRule = null
    inviteRequests.viewRule = null
    app.save(inviteRequests)
  }
})
