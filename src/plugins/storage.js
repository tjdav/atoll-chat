import { createPlugin } from 'coralite';

export default createPlugin({
  name: 'storage-plugin',
  client: {
    helpers: {
      getPrivateKey: () => async (userId) => {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open('CoraliteChatStorage', 1);

          request.onerror = (event) => {
            reject('Database error: ' + event.target.errorCode);
          };

          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            db.createObjectStore('privateKeys', { keyPath: 'userId' });
          };

          request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['privateKeys'], 'readonly');
            const store = transaction.objectStore('privateKeys');
            const getRequest = store.get(userId);

            getRequest.onsuccess = () => {
              if (getRequest.result) {
                resolve(getRequest.result.key);
              } else {
                resolve(null);
              }
            };

            getRequest.onerror = () => {
              reject('Error getting private key');
            };
          };
        });
      },
      setPrivateKey: () => async (userId, privateKey) => {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open('CoraliteChatStorage', 1);

          request.onerror = (event) => {
            reject('Database error: ' + event.target.errorCode);
          };

          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('privateKeys')) {
              db.createObjectStore('privateKeys', { keyPath: 'userId' });
            }
          };

          request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction(['privateKeys'], 'readwrite');
            const store = transaction.objectStore('privateKeys');
            const putRequest = store.put({ userId, key: privateKey });

            putRequest.onsuccess = () => {
              resolve();
            };

            putRequest.onerror = () => {
              reject('Error saving private key');
            };
          };
        });
      }
    }
  }
});