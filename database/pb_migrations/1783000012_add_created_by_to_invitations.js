migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const invitations = app.findCollectionByNameOrId('invitations')

  if (invitations && !invitations.fields.getByName('created_by')) {
    invitations.fields.add(new RelationField({
      name: 'created_by',
      required: false,
      collectionId: users.id,
      cascadeDelete: false,
      maxSelect: 1
    }))
    app.save(invitations)
  }
}, (app) => {
  try {
    const invitations = app.findCollectionByNameOrId('invitations')
    if (invitations && invitations.fields.getByName('created_by')) {
      invitations.fields.removeByName('created_by')
      app.save(invitations)
    }
  } catch (_err) {
    // collection or field deletion failed
  }
})
