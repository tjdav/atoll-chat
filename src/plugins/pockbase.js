import { createPlugin } from 'coralite';

export default createPlugin({
  name: 'pocketbase-plugin',
  client: {
    imports: [
      {
        specifier: 'https://esm.sh/pocketbase',
        defaultExport: 'PocketBase'
      }
    ],
    config: {
      baseUrl: 'http://127.0.0.1:8090'
    },
    setup (context) {
      const PocketBase = context.imports.PocketBase;
      const baseUrl = context.config.baseUrl;

      const pb = new PocketBase(baseUrl);

      // Simple implementation of single-session auth using sessionStorage if localStorage is cleared
      const sessionAuth = sessionStorage.getItem('pocketbase_auth');
      if (sessionAuth && !localStorage.getItem('pocketbase_auth')) {
        try {
          const parsed = JSON.parse(sessionAuth);
          if (parsed.token && parsed.model) {
            pb.authStore.save(parsed.token, parsed.model);
            // Pocketbase saves back to localStorage, so we clear it if we are in session mode
            localStorage.removeItem('pocketbase_auth');
          }
        } catch (e) {
          // ignore
        }
      }

      return {
        pb
      }
    },
    helpers: {
      // Helper for Registration
      register: (context) => async (email, password) => {
        try {
          const pb = context.values.pb;
          const result = await pb.collection('users').create({
            email,
            password,
            passwordConfirm: password
          });
          return result;
        } catch (error) {
          console.error('Pocketbase registration failed:', error);
          throw error;
        }
      },

      // Helper for Updating User
      updateUser: (context) => async (userId, data) => {
         try {
           const pb = context.values.pb;
           return await pb.collection('users').update(userId, data);
         } catch (error) {
           console.error('Pocketbase updateUser failed:', error);
           throw error;
         }
      },

      // Helper to Create Conversation
      createConversation: (context) => async (data) => {
        try {
          const pb = context.values.pb;
          return await pb.collection('conversations').create(data);
        } catch (error) {
          console.error('Pocketbase createConversation failed:', error);
          throw error;
        }
      },

      // Helper to Create Conversation Member
      createConversationMember: (context) => async (data) => {
        try {
          const pb = context.values.pb;
          return await pb.collection('conversation_members').create(data);
        } catch (error) {
          console.error('Pocketbase createConversationMember failed:', error);
          throw error;
        }
      },

      // Helper to Get User Conversations
      getUserConversations: (context) => async (userId) => {
        try {
          const pb = context.values.pb;
          return await pb.collection('conversation_members').getFullList({
            filter: `user = "${userId}"`,
            expand: 'conversation'
          });
        } catch (error) {
          console.error('Pocketbase getUserConversations failed:', error);
          throw error;
        }
      },

      // Helper for Authentication
      login: (context) => async (email, password, rememberMe = false) => {
        try {
          const pb = context.values.pb;
          const result = await pb.collection('users').authWithPassword(email, password);
          
          if (!rememberMe) {
            // Pocketbase uses localStorage by default. If not rememberMe,
            // we should store auth state in sessionStorage instead
            const token = pb.authStore.token;
            const model = pb.authStore.model;
            
            // Clear default localStorage store
            pb.authStore.clear();
            
            // Note: Since standard Pocketbase v0.8+ doesn't have a built-in session store,
            // we can simulate session persistence by keeping it in memory
            // but normally the browser just handles localStorage.
            // If the user did not check 'Remember me', when the page reloads they will lose session
            // To make it persist for the session, we can write to sessionStorage manually
            // However, PocketBase AuthStore just uses localStorage. We can override the store or just
            // clear localStorage and use an in-memory or sessionStorage authStore if we really need
            // to support single-session login.
            sessionStorage.setItem('pocketbase_auth', JSON.stringify({ token, model }));
            
            // But for simple "don't persist" behaviour:
            // Pocketbase's standard JS SDK `pb.authStore` is tied to `localStorage` (by default under key "pocketbase_auth").
            // So if we don't want to remember, we can just remove it from localStorage.
            localStorage.removeItem('pocketbase_auth');
            
            // Repopulate in-memory state
            pb.authStore.save(token, model);
          }
          return result;
        } catch (error) {
          console.error('Pocketbase login failed:', error);
          throw error;
        }
      },

      // Helper to get current user ID
      getCurrentUserId: (context) => () => {
         return context.values.pb.authStore.model?.id;
      },

      // Helper to subscribe to real-time messages
      subscribeToMessages: (context) => (conversationId, callback) => {
        const pb = context.values.pb;

        // Subscribing to specific conversation's messages
        pb.collection('messages').subscribe('*', function (e) {
            if (e.record.conversation === conversationId) {
                callback(e.action, e.record);
            }
        });

        // Return an unsubscribe function
        return () => pb.collection('messages').unsubscribe('*');
      },
      
      // Get historical messages
      getMessages: (context) => async (conversationId) => {
        try {
          const pb = context.values.pb;
          return await pb.collection('messages').getList(1, 50, {
             filter: `conversation = "${conversationId}"`,
             sort: 'created'
          });
        } catch(error) {
          console.error('Pocketbase getMessages failed:', error);
          throw error;
        }
      },

      // Helper to send a message (with optional file attachment)
      sendMessage: (context) => async (ciphertext, iv, conversationId, file) => {
        try {
          const pb = context.values.pb;
          const formData = new FormData();

          formData.append('ciphertext', ciphertext);
          formData.append('iv', iv);
          formData.append('conversation', conversationId);
          formData.append('user', pb.authStore.model?.id || '');

          if (file) {
              formData.append('attachment', file);
          }

          return await pb.collection('messages').create(formData);
        } catch (error) {
          console.error('Pocketbase sendMessage failed:', error);
          throw error;
        }
      }
    }
  }
});
