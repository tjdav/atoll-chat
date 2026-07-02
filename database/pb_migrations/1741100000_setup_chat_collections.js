/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  let rooms;
  try {
    rooms = app.findCollectionByNameOrId('pbc_3085411453');
  } catch (err) {
    rooms = new Collection({ id: 'pbc_3085411453' });
  }

  rooms.name = 'rooms';
  rooms.type = 'base';
  rooms.listRule = '@request.auth.id != ""';
  rooms.viewRule = '@request.auth.id != ""';
  rooms.createRule = '@request.auth.id != ""';
  rooms.updateRule = '@request.auth.id != ""';
  rooms.deleteRule = '@request.auth.id != ""';

  if (!rooms.fields.getByName('is_group')) {
    rooms.fields.add(new BoolField({
      name: 'is_group',
      required: true,
      help: 'True if it\'s a multi-user group chat, false for a standard 1-to-1 conversation.'
    }));
  }

  if (!rooms.fields.getByName('encrypted_metadata')) {
    rooms.fields.add(new JSONField({
      name: 'encrypted_metadata',
      required: true,
      help: 'Stores the symmetrically encrypted JSON containing the group\'s name and avatar URL.'
    }));
  }

  if (!rooms.fields.getByName('created')) {
    rooms.fields.add(new AutodateField({
      name: 'created',
      onCreate: true
    }));
  }

  if (!rooms.fields.getByName('updated')) {
    rooms.fields.add(new AutodateField({
      name: 'updated',
      onCreate: true,
      onUpdate: true
    }));
  }

  app.save(rooms);

  const users = app.findCollectionByNameOrId('users');

  let roomMembers;
  try {
    roomMembers = app.findCollectionByNameOrId('pbc_4263127577');
  } catch (err) {
    roomMembers = new Collection({ id: 'pbc_4263127577' });
  }

  roomMembers.name = 'room_members';
  roomMembers.type = 'base';
  roomMembers.listRule = '@request.auth.id != ""';
  roomMembers.viewRule = '@request.auth.id != ""';
  roomMembers.createRule = '@request.auth.id != ""';
  roomMembers.updateRule = '@request.auth.id != ""';
  roomMembers.deleteRule = '@request.auth.id != ""';
  roomMembers.indexes = [
    'CREATE UNIQUE INDEX idx_room_user ON room_members (room_id, user_id)'
  ];

  if (!roomMembers.fields.getByName('room_id')) {
    roomMembers.fields.add(new RelationField({
      name: 'room_id',
      required: true,
      maxSelect: 1,
      collectionId: rooms.id,
      cascadeDelete: true
    }));
  }

  if (!roomMembers.fields.getByName('user_id')) {
    roomMembers.fields.add(new RelationField({
      name: 'user_id',
      required: true,
      maxSelect: 1,
      collectionId: users.id,
      cascadeDelete: true,
      help: 'The member receiving the access key.'
    }));
  }

  if (!roomMembers.fields.getByName('wrapped_by')) {
    roomMembers.fields.add(new RelationField({
      name: 'wrapped_by',
      required: true,
      maxSelect: 1,
      collectionId: users.id,
      cascadeDelete: false,
      help: 'The ID of the user who invited this member and wrapped the key. The client uses this to know whose public key to verify against.'
    }));
  }

  if (!roomMembers.fields.getByName('encrypted_room_key')) {
    roomMembers.fields.add(new TextField({
      name: 'encrypted_room_key',
      required: true,
      help: 'The base64-encoded 32-byte shared Room Key, encrypted specifically for the user_id using Libsodium.'
    }));
  }

  if (!roomMembers.fields.getByName('key_nonce')) {
    roomMembers.fields.add(new TextField({
      name: 'key_nonce',
      required: true
    }));
  }

  if (!roomMembers.fields.getByName('role')) {
    roomMembers.fields.add(new SelectField({
      name: 'role',
      required: true,
      maxSelect: 1,
      values: ['member', 'admin', 'kicked']
    }));
  }

  if (!roomMembers.fields.getByName('created')) {
    roomMembers.fields.add(new AutodateField({
      name: 'created',
      onCreate: true
    }));
  }

  if (!roomMembers.fields.getByName('updated')) {
    roomMembers.fields.add(new AutodateField({
      name: 'updated',
      onCreate: true,
      onUpdate: true
    }));
  }

  app.save(roomMembers);
}, (app) => {
  const roomMembers = app.findCollectionByNameOrId('room_members')
  if (roomMembers) {
    app.delete(roomMembers)
  }

  const rooms = app.findCollectionByNameOrId('rooms')
  if (rooms) {
    app.delete(rooms)
  }
})
