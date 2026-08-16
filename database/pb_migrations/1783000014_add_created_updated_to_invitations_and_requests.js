migrate((app) => {
  const collections = app.findAllCollections()
  const invitations = collections.find((c) => c.name === 'invitations' || c.id === 'invitations')
  const inviteRequests = collections.find((c) => c.name === 'invite_requests' || c.id === 'invite_requests')

  if (invitations) {
    let changed = false
    if (!invitations.fields.getByName('created')) {
      invitations.fields.add(new AutodateField({
        name: 'created',
        onCreate: true,
        onUpdate: false
      }))
      changed = true
    }
    if (!invitations.fields.getByName('updated')) {
      invitations.fields.add(new AutodateField({
        name: 'updated',
        onCreate: true,
        onUpdate: true
      }))
      changed = true
    }
    if (changed) {
      app.save(invitations)
    }
  }

  if (inviteRequests) {
    let changed = false
    if (!inviteRequests.fields.getByName('created')) {
      inviteRequests.fields.add(new AutodateField({
        name: 'created',
        onCreate: true,
        onUpdate: false
      }))
      changed = true
    }
    if (!inviteRequests.fields.getByName('updated')) {
      inviteRequests.fields.add(new AutodateField({
        name: 'updated',
        onCreate: true,
        onUpdate: true
      }))
      changed = true
    }
    if (changed) {
      app.save(inviteRequests)
    }
  }
}, (app) => {
  const collections = app.findAllCollections()
  const invitations = collections.find((c) => c.name === 'invitations' || c.id === 'invitations')
  const inviteRequests = collections.find((c) => c.name === 'invite_requests' || c.id === 'invite_requests')

  if (invitations) {
    let changed = false
    if (invitations.fields.getByName('created')) {
      invitations.fields.removeByName('created')
      changed = true
    }
    if (invitations.fields.getByName('updated')) {
      invitations.fields.removeByName('updated')
      changed = true
    }
    if (changed) {
      app.save(invitations)
    }
  }

  if (inviteRequests) {
    let changed = false
    if (inviteRequests.fields.getByName('created')) {
      inviteRequests.fields.removeByName('created')
      changed = true
    }
    if (inviteRequests.fields.getByName('updated')) {
      inviteRequests.fields.removeByName('updated')
      changed = true
    }
    if (changed) {
      app.save(inviteRequests)
    }
  }
})
