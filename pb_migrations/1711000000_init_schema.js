/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Update users collection
  const users = app.findCollectionByNameOrId('users')
  users.fields.add(new TextField({
    name: 'displayName'
  }))
  users.fields.add(new TextField({
    name: 'public_key',
    required: true
  }))
  // Note: users collection already has an 'avatar' field by default.
  app.save(users)

  // Create rooms collection
  const rooms = new Collection({
    name: 'rooms',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    fields: [
      new TextField({ name: 'name' }),
      new TextField({ name: 'topic' }),
      new FileField({
        name: 'avatar',
        maxSelect: 1
      })
    ]
  })
  app.save(rooms)

  // Create messages collection
  const messages = new Collection({
    name: 'messages',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: rooms.id,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'sender_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new TextField({
        name: 'payload',
        required: true
      }),
      new TextField({ name: 'msgtype' })
    ]
  })
  app.save(messages)

  // Create room_members collection
  const roomMembers = new Collection({
    name: 'room_members',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: rooms.id,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'user_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new SelectField({
        name: 'status',
        required: true,
        maxSelect: 1,
        values: ['invited', 'joined', 'left']
      }),
      new TextField({
        name: 'encrypted_room_key',
        required: true
      }),
      new RelationField({
        name: 'last_read_message_id',
        collectionId: messages.id,
        maxSelect: 1
      })
    ]
  })
  app.save(roomMembers)

  // Create reactions collection
  const reactions = new Collection({
    name: 'reactions',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      new RelationField({
        name: 'message_id',
        collectionId: messages.id,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'user_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new TextField({
        name: 'emoji',
        required: true
      })
    ]
  })
  app.save(reactions)

  // Create trusted_contacts collection
  const trustedContacts = new Collection({
    name: 'trusted_contacts',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      new RelationField({
        name: 'owner_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'trusted_user_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new TextField({
        name: 'public_key_fingerprint',
        required: true
      })
    ]
  })
  app.save(trustedContacts)

  // Create call_signals collection
  const callSignals = new Collection({
    name: 'call_signals',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: rooms.id,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'sender_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'target_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new TextField({
        name: 'signal_data',
        required: true
      })
    ]
  })
  app.save(callSignals)

  // Create ephemeral_states collection
  const ephemeralStates = new Collection({
    name: 'ephemeral_states',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: "@request.auth.id != ''",
    deleteRule: "@request.auth.id != ''",
    fields: [
      new RelationField({
        name: 'room_id',
        collectionId: rooms.id,
        required: true,
        maxSelect: 1
      }),
      new RelationField({
        name: 'user_id',
        collectionId: users.id,
        required: true,
        maxSelect: 1
      }),
      new BoolField({ name: 'is_typing' }),
      new DateField({ name: 'expires_at' })
    ]
  })
  app.save(ephemeralStates)

}, (app) => {
  // Down migration
  app.delete(app.findCollectionByNameOrId('ephemeral_states'))
  app.delete(app.findCollectionByNameOrId('call_signals'))
  app.delete(app.findCollectionByNameOrId('trusted_contacts'))
  app.delete(app.findCollectionByNameOrId('reactions'))
  app.delete(app.findCollectionByNameOrId('room_members'))
  app.delete(app.findCollectionByNameOrId('messages'))
  app.delete(app.findCollectionByNameOrId('rooms'))

  const users = app.findCollectionByNameOrId('users')
  users.fields.removeByName('displayName')
  users.fields.removeByName('public_key')
  app.save(users)
})
