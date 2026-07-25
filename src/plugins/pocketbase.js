/**
 * @import PocketBase, { RecordAuthResponse, RecordModel, ListResult, RecordListOptions, RecordOptions, RecordSubscription, RecordSubscribeOptions, FileOptions, OTPResponse } from 'pocketbase'
 */

import { definePlugin } from 'coralite'

/**
 * PocketBase Coralite plugin with Extended Abstraction API layer.
 *
 * @param {Object} [options={}] Plugin configuration options.
 * @param {string} [options.baseUrl='/'] The PocketBase API base URL.
 * @returns {Object} Coralite plugin object.
 */
export default function pocketbase (options = {}) {
  const url = options.baseUrl || '/'

  /**
   * Creates the Authentication API helper instance.
   *
   * @param {PocketBase} pb PocketBase SDK client instance.
   * @returns {Object} Auth helper API.
   */
  const createAuthApi = (pb) => ({
    /**
     * Authenticates a user with identity and password.
     *
     * @param {string} identity Username or email.
     * @param {string} password Account password.
     * @returns {Promise<RecordAuthResponse>} Auth response.
     */
    async login (identity, password, options = {}) {
      return await pb.collection('users').authWithPassword(identity, password, options)
    },

    /**
     * Requests an OTP code.
     *
     * @param {string} identity Username or email.
     * @returns {Promise<OTPResponse>} OTP challenge response.
     */
    async requestOTP (identity) {
      return await pb.collection('users').requestOTP(identity)
    },

    /**
     * Verifies an OTP code.
     *
     * @param {string} otpId OTP challenge ID.
     * @param {string} code 6-digit code.
     * @returns {Promise<RecordAuthResponse>} Auth response.
     */
    async verifyOTP (otpId, code) {
      return await pb.collection('users').authWithOTP(otpId, code)
    },

    /**
     * Clears authentication session tokens.
     */
    logout () {
      pb.authStore.clear()
    },

    /**
     * Retrieves current user record.
     *
     * @returns {RecordModel|null} Authenticated user record.
     */
    getUser () {
      return pb.authStore.record || pb.authStore.model || null
    },

    /**
     * Retrieves current auth token string.
     *
     * @returns {string} JWT token string.
     */
    getToken () {
      return pb.authStore.token || ''
    },

    /**
     * Checks if session is valid.
     *
     * @returns {boolean} True if valid.
     */
    isAuthenticated () {
      return Boolean(pb.authStore.isValid)
    },

    /**
     * Registers auth state change listener.
     *
     * @param {function(string, RecordModel|null): void} callback Listener callback.
     * @returns {function(): void} Unsubscribe callback.
     */
    onAuthChange (callback) {
      return pb.authStore.onChange((token, record) => {
        callback(token, record)
      })
    }
  })

  /**
   * Creates the Record CRUD API helper instance.
   *
   * @param {PocketBase} pb PocketBase SDK client instance.
   * @returns {Object} Record CRUD helper API.
   */
  const createRecordApi = (pb) => ({
    /**
     * Gets a paginated list of records.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {number} [page=1] Page index.
     * @param {number} [perPage=30] Records per page.
     * @param {RecordListOptions} [options={}] Query options.
     * @returns {Promise<ListResult<T>>} Paginated result.
     */
    async getList (collection, page = 1, perPage = 30, options = {}) {
      return await pb.collection(collection).getList(page, perPage, options)
    },

    /**
     * Gets all records from a collection.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {RecordListOptions} [options={}] Query options.
     * @returns {Promise<T[]>} Matching records.
     */
    async getFullList (collection, options = {}) {
      return await pb.collection(collection).getFullList(options)
    },

    /**
     * Gets single record by ID.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {string} id Record ID.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<T>} Fetched record.
     */
    async getOne (collection, id, options = {}) {
      return await pb.collection(collection).getOne(id, options)
    },

    /**
     * Gets first record matching filter.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {string} filter Filter expression string.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<T>} First matching record.
     */
    async getFirst (collection, filter, options = {}) {
      return await pb.collection(collection).getFirstListItem(filter, options)
    },

    /**
     * Creates a new record.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {Object|FormData} data Record data.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<T>} Created record.
     */
    async create (collection, data, options = {}) {
      return await pb.collection(collection).create(data, options)
    },

    /**
     * Updates an existing record.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {string} id Record ID to update.
     * @param {Object|FormData} data Data to update.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<T>} Updated record.
     */
    async update (collection, id, data, options = {}) {
      return await pb.collection(collection).update(id, data, options)
    },

    /**
     * Deletes a record by ID.
     *
     * @param {string} collection Collection name.
     * @param {string} id Record ID to delete.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<boolean>} True on success.
     */
    async delete (collection, id, options = {}) {
      return await pb.collection(collection).delete(id, options)
    }
  })

  /**
   * Creates the Realtime API helper instance.
   *
   * @param {PocketBase} pb PocketBase SDK client instance.
   * @returns {Object} Realtime helper API.
   */
  const createRealtimeApi = (pb) => ({
    /**
     * Subscribes to realtime events.
     *
     * @param {string} collection Collection name.
     * @param {string} topic Subscription topic.
     * @param {function(RecordSubscription): void} callback Listener function.
     * @param {RecordSubscribeOptions} [options={}] Subscription options.
     * @returns {Promise<function(): Promise<void>>} Unsubscribe callback.
     */
    async subscribe (collection, topic, callback, options = {}) {
      return await pb.collection(collection).subscribe(topic, callback, options)
    },

    /**
     * Unsubscribes from realtime events.
     *
     * @param {string} collection Collection name.
     * @param {string} [topic='*'] Subscription topic.
     * @returns {Promise<boolean|void>} True on success.
     */
    async unsubscribe (collection, topic) {
      return await pb.collection(collection).unsubscribe(topic)
    }
  })

  /**
   * Creates the File API helper instance.
   *
   * @param {PocketBase} pb PocketBase SDK client instance.
   * @returns {Object} File helper API.
   */
  const createFileApi = (pb) => ({
    /**
     * Constructs a full file URL.
     *
     * @param {RecordModel} record Record instance.
     * @param {string} filename File field value.
     * @param {FileOptions} [options={}] Thumb or query options.
     * @returns {string} Asset URL string.
     */
    getUrl (record, filename, options = {}) {
      if (!record || !filename) {
        return ''
      }
      return pb.files.getURL(record, filename, options)
    },

    /**
     * Constructs a full file URL.
     *
     * @param {RecordModel} record Record instance.
     * @param {string} filename File field value.
     * @param {FileOptions} [options={}] Thumb or query options.
     * @returns {string} Asset URL string.
     */
    getURL (record, filename, options = {}) {
      if (!record || !filename) {
        return ''
      }
      return pb.files.getURL(record, filename, options)
    }
  })

  return definePlugin({
    name: 'pocketbase',
    server: {
      context: async () => {
        const { default: PocketBase } = await import('pocketbase')
        const pb = new PocketBase(url)
        pb.autoCancellation(false)

        return () => {
          return {
            pb,
            auth: createAuthApi(pb),
            records: createRecordApi(pb),
            realtime: createRealtimeApi(pb),
            files: createFileApi(pb)
          }
        }
      }
    },
    client: {
      config: {
        url
      },
      context: async (pluginContext) => {
        const { default: PocketBase } = await import('pocketbase')
        const pb = new PocketBase(pluginContext.config.url)
        pb.autoCancellation(false)

        const originalBuildURL = pb.buildURL.bind(pb)
        pb.buildURL = (path, params) => {
          return originalBuildURL(path, params)
        }

        const createAuthApi = (instance) => ({
          async login (identity, password, options = {}) {
            return await instance.collection('users').authWithPassword(identity, password, options)
          },
          async requestOTP (identity) {
            return await instance.collection('users').requestOTP(identity)
          },
          async verifyOTP (otpId, code) {
            return await instance.collection('users').authWithOTP(otpId, code)
          },
          logout () {
            instance.authStore.clear()
          },
          getUser () {
            return instance.authStore.record || instance.authStore.model || null
          },
          getToken () {
            return instance.authStore.token || ''
          },
          isAuthenticated () {
            return Boolean(instance.authStore.isValid)
          },
          onAuthChange (callback) {
            return instance.authStore.onChange((token, record) => {
              callback(token, record)
            })
          }
        })

        const createRecordApi = (instance) => ({
          async getList (collection, page = 1, perPage = 30, options = {}) {
            return await instance.collection(collection).getList(page, perPage, options)
          },
          async getFullList (collection, options = {}) {
            return await instance.collection(collection).getFullList(options)
          },
          async getOne (collection, id, options = {}) {
            return await instance.collection(collection).getOne(id, options)
          },
          async getFirst (collection, filter, options = {}) {
            return await instance.collection(collection).getFirstListItem(filter, options)
          },
          async create (collection, data, options = {}) {
            return await instance.collection(collection).create(data, options)
          },
          async update (collection, id, data, options = {}) {
            return await instance.collection(collection).update(id, data, options)
          },
          async delete (collection, id, options = {}) {
            return await instance.collection(collection).delete(id, options)
          }
        })

        const createRealtimeApi = (instance) => ({
          async subscribe (collection, topic, callback, options = {}) {
            return await instance.collection(collection).subscribe(topic, callback, options)
          },
          async unsubscribe (collection, topic) {
            return await instance.collection(collection).unsubscribe(topic)
          }
        })

        const createFileApi = (instance) => ({
          getUrl (record, filename, options = {}) {
            if (!record || !filename) {
              return ''
            }
            return instance.files.getURL(record, filename, options)
          },
          getURL (record, filename, options = {}) {
            if (!record || !filename) {
              return ''
            }
            return instance.files.getURL(record, filename, options)
          }
        })

        const auth = createAuthApi(pb)
        const records = createRecordApi(pb)
        const realtime = createRealtimeApi(pb)
        const files = createFileApi(pb)

        return () => {
          return {
            pb,
            auth,
            records,
            realtime,
            files
          }
        }
      }
    }
  })
}
