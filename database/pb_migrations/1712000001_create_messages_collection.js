migrate((app) => {
  const collection = new Collection({
    name: 'messages',
    type: 'base',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != ''",
    updateRule: null,
    deleteRule: null,
    schema: [
      {
        name: 'room_id',
        type: 'relation',
        required: true,
        description: 'The chat room this message belongs to.',
        options: {
          collectionId: 'rooms',
          cascadeDelete: true,
          maxSelect: 1
        }
      },
      {
        name: 'sender_id',
        type: 'relation',
        required: true,
        description: 'The user who sent the message.',
        options: {
          collectionId: 'users',
          cascadeDelete: false,
          maxSelect: 1
        }
      },
      {
        name: 'epoch_id',
        type: 'number',
        required: true,
        description: "The Key Generation/Epoch ID. This tells the receiving client's Web Worker exactly which historical Room Key from their IndexedDB to use for decryption.",
        options: {
          noDecimal: true
        }
      },
      {
        name: 'previous_msg_uuid',
        type: 'text',
        required: true,
        description: 'The database ID of the message that immediately preceded this one. This creates a cryptographic chain that the client verifies to defeat server-side "time travel" or message reordering attacks.'
      },
      {
        name: 'payload',
        type: 'json',
        required: true,
        description: 'The base64-encoded, symmetrically encrypted JSON string. The server cannot read this. (Once decrypted on the client, it will reveal the type (text, media, call_offer) and the actual content).'
      },
      {
        name: 'signature',
        type: 'text',
        required: true,
        description: "The Ed25519 signature of the payload, signed by the sender's private_sign_key. The receiving Web Worker will verify this against the sender's public_sign_key to prevent the server from injecting fake messages."
      }
    ],
    indexes: [
      'CREATE INDEX idx_messages_room_created ON messages (room_id, created DESC)'
    ]
  })

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('messages')
  return app.delete(collection)
})
