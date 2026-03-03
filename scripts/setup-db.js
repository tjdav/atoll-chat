import PocketBase from 'pocketbase';
import 'dotenv/config';

const pb = new PocketBase('http://127.0.0.1:8090');

const adminEmail = process.env.PB_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.PB_ADMIN_PASSWORD || 'admin123456';

async function setupDatabase() {
  if (!process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    console.warn(`⚠️ Warning: Using default admin credentials (${adminEmail} / ${adminPassword}). Please set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables.`);
  }

  try {
    console.log('Authenticating as admin...');
    await pb.admins.authWithPassword(adminEmail, adminPassword);
    console.log('Successfully authenticated as admin.');

    console.log('Setting up collections...');

    // 1. Ensure `users` collection has `public_key` field
    let usersCollection;
    try {
      usersCollection = await pb.collections.getOne('users');
      console.log('users collection found.');
      
      const hasPublicKey = usersCollection.fields.some(f => f.name === 'public_key');
      if (!hasPublicKey) {
        usersCollection.fields.push({
          name: 'public_key',
          type: 'text',
          required: false,
          system: false,
          unique: false
        });
        await pb.collections.update('users', usersCollection);
        console.log('Added public_key field to users collection.');
      }
    } catch (e) {
      console.error('Error fetching users collection:', e);
    }

    // 2. Create `conversations` Collection
    let conversationsCollection;
    try {
      conversationsCollection = await pb.collections.getOne('conversations');
      console.log('conversations collection already exists.');
    } catch (e) {
      console.log('Creating conversations collection...');
      conversationsCollection = await pb.collections.create({
        name: 'conversations',
        type: 'base',
        system: false,
        fields: [
          {
            name: 'name',
            type: 'text',
            required: false,
          },
          {
            name: 'type',
            type: 'select',
            required: true,
            maxSelect: 1,
            values: ['direct', 'group']
          }
        ],
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: null,
      });
      console.log('conversations collection created.');
    }

    // 3. Create `conversation_members` Collection
    let conversationMembersCollection;
    try {
      conversationMembersCollection = await pb.collections.getOne('conversation_members');
      console.log('conversation_members collection already exists.');
    } catch (e) {
      console.log('Creating conversation_members collection...');
      conversationMembersCollection = await pb.collections.create({
        name: 'conversation_members',
        type: 'base',
        system: false,
        fields: [
          {
            name: 'conversation',
            type: 'relation',
            required: true,
            collectionId: conversationsCollection.id,
            cascadeDelete: true,
            maxSelect: 1
          },
          {
            name: 'user',
            type: 'relation',
            required: true,
            collectionId: usersCollection.id,
            cascadeDelete: true,
            maxSelect: 1
          },
          {
            name: 'encrypted_chat_key',
            type: 'text',
            required: true,
          }
        ],
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id = user.id', // User can update their own member record
        deleteRule: '@request.auth.id = user.id', // User can remove themselves
      });
      console.log('conversation_members collection created.');
    }

    // 4. Update/Create `messages` Collection
    let messagesCollection;
    const messagesSchema = [
      {
        name: 'conversation',
        type: 'relation',
        required: true,
        collectionId: conversationsCollection.id,
        cascadeDelete: true,
        maxSelect: 1
      },
      {
        name: 'user',
        type: 'relation',
        required: true,
        collectionId: usersCollection.id,
        cascadeDelete: true,
        maxSelect: 1
      },
      {
        name: 'ciphertext',
        type: 'text',
        required: true,
      },
      {
        name: 'iv',
        type: 'text',
        required: true,
      },
      {
        name: 'attachment',
        type: 'file',
        required: false,
        maxSelect: 1,
      }
    ];

    try {
      messagesCollection = await pb.collections.getOne('messages');
      console.log('messages collection found, updating schema...');
      
      messagesCollection.fields = messagesSchema;
      messagesCollection.listRule = '@request.auth.id ?= conversation.conversation_members.user.id';
      messagesCollection.viewRule = '@request.auth.id ?= conversation.conversation_members.user.id';
      messagesCollection.createRule = '@request.auth.id = user.id && @request.auth.id ?= conversation.conversation_members.user.id';
      messagesCollection.updateRule = null;
      messagesCollection.deleteRule = null;
      
      await pb.collections.update('messages', messagesCollection);
      console.log('messages collection updated successfully.');
      
    } catch (e) {
      console.log('messages collection not found, creating...');
      await pb.collections.create({
        name: 'messages',
        type: 'base',
        system: false,
        fields: messagesSchema,
        listRule: '@request.auth.id != ""', // simplifying for MVP
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id = user.id',
      });
      console.log('messages collection created successfully.');
    }

    // Now update conversation rules correctly
    console.log('Updating conversation collection rules...');
    conversationsCollection.listRule = '@request.auth.id != ""';
    conversationsCollection.viewRule = '@request.auth.id != ""';
    conversationsCollection.updateRule = '@request.auth.id != ""';
    await pb.collections.update('conversations', conversationsCollection);
    console.log('Updated conversation collection rules.');

    console.log('Database setup complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error during database setup:', error);
    process.exit(1);
  }
}

setupDatabase();