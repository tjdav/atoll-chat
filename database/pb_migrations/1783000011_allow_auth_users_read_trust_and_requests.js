migrate((app) => {
  try {
    const userTrust = app.findCollectionByNameOrId('user_trust')
    userTrust.listRule = '@request.auth.id != ""'
    userTrust.viewRule = '@request.auth.id != ""'
    app.save(userTrust)
  } catch (_err) {
  }

  try {
    const inviteRequests = app.findCollectionByNameOrId('invite_requests')
    inviteRequests.listRule = '@request.auth.id != ""'
    inviteRequests.viewRule = '@request.auth.id != ""'
    app.save(inviteRequests)
  } catch (_err) {
  }
}, (app) => {
  try {
    const userTrust = app.findCollectionByNameOrId('user_trust')
    userTrust.listRule = null
    userTrust.viewRule = null
    app.save(userTrust)
  } catch (_err) {
  }

  try {
    const inviteRequests = app.findCollectionByNameOrId('invite_requests')
    inviteRequests.listRule = null
    inviteRequests.viewRule = null
    app.save(inviteRequests)
  } catch (_err) {
  }
})
