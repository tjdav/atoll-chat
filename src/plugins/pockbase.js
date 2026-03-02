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
      const pbUrl = context.config.pbUrl;

      return {
        pb: new PocketBase(pbUrl)
      }
    },
    helpers: {
      // Helper for Authentication
      login: (context) => async (email, password) => {
        try {
          const pb = context.values.pb;
          return await pb.collection('users').authWithPassword(email, password);
        } catch (error) {
          console.error('Pocketbase login failed:', error);
          throw error;
        }
      },

      // Helper to subscribe to real-time messages
      subscribeToMessages: (context) => (callback) => {
        const pb = context.values.pb;

        pb.collection('messages').subscribe('*', function (e) {
            callback(e.action, e.record);
        });

        // Return an unsubscribe function
        return () => pb.collection('messages').unsubscribe('*');
      },

      // Helper to send a message (with optional file attachment)
      sendMessage: (context) => async (text, file) => {
        try {
          const pb = context.values.pb;
          const formData = new FormData();

          formData.append('text', text);
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
