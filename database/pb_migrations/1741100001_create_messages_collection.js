migrate((app) => {
  const rooms = app.findCollectionByNameOrId('rooms')
  const users = app.findCollectionByNameOrId('users')

  const collection = new Collection({
    name: 'messages',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: null,
    deleteRule: null,
    indexes: [
      'CREATE INDEX idx_messages_room_created ON messages (room_id, created DESC)'
    ]
  })

  collection.fields.add(new RelationField({
    name: 'room_id',
    required: true,
    help: 'The chat room this message belongs to.',
    collectionId: rooms.id,
    cascadeDelete: true,
    maxSelect: 1
  }))

  collection.fields.add(new RelationField({
    name: 'sender_id',
    required: true,
    help: 'The user who sent the message.',
    collectionId: users.id,
    cascadeDelete: false,
    maxSelect: 1
  }))

  collection.fields.add(new NumberField({
    name: 'epoch_id',
    required: true,
    help: "The Key Generation/Epoch ID. This tells the receiving client's Web Worker exactly which historical Room Key from their IndexedDB to use for decryption.",
    noDecimal: true
  }))

  collection.fields.add(new TextField({
    name: 'previous_msg_uuid',
    required: true,
    help: 'The database ID of the message that immediately preceded this one. This creates a cryptographic chain that the client verifies to defeat server-side "time travel" or message reordering attacks.'
  }))

  collection.fields.add(new JSONField({
    name: 'payload',
    required: true,
    help: 'The base64-encoded, symmetrically encrypted JSON string. The server cannot read this. (Once decrypted on the client, it will reveal the type (text, media, call_offer) and the actual content).'
  }))

  collection.fields.add(new TextField({
    name: 'signature',
    required: true,
    help: "The Ed25519 signature of the payload, signed by the sender's private_sign_key. The receiving Web Worker will verify this against the sender's public_sign_key to prevent the server from injecting fake messages."
  }))

  collection.fields.add(new AutodateField({
    name: 'created',
    onCreate: true
  }))

  collection.fields.add(new AutodateField({
    name: 'updated',
    onCreate: true,
    onUpdate: true
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('messages')
  if (collection) {
    return app.delete(collection)
  }
})
