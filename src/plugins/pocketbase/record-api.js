/**
 * @import PocketBase, { RecordModel, ListResult, RecordListOptions, RecordOptions } from 'pocketbase'
 */

/**
 * Creates the PocketBase Record CRUD Abstraction API.
 * Encapsulates data query, insertion, update, and deletion operations.
 *
 * @param {PocketBase} pb PocketBase SDK client instance.
 * @returns {Object} Record CRUD API helper methods.
 */
export function createRecordApi (pb) {
  return {
    /**
     * Fetches a paginated list of records from a collection.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {number} [page=1] Target page number (1-indexed).
     * @param {number} [perPage=30] Number of records per page.
     * @param {RecordListOptions} [options={}] Additional query parameters.
     * @returns {Promise<ListResult<T>>} Paginated result set.
     */
    async getList (collection, page = 1, perPage = 30, options = {}) {
      return await pb.collection(collection).getList(page, perPage, options)
    },

    /**
     * Fetches all records from a collection matching optional filter criteria.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {RecordListOptions} [options={}] Additional query parameters.
     * @returns {Promise<T[]>} List of all matching records.
     */
    async getFullList (collection, options = {}) {
      return await pb.collection(collection).getFullList(options)
    },

    /**
     * Fetches a single record by its unique ID.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {string} id Unique record ID.
     * @param {RecordOptions} [options={}] Query parameters.
     * @returns {Promise<T>} The fetched record instance.
     */
    async getOne (collection, id, options = {}) {
      return await pb.collection(collection).getOne(id, options)
    },

    /**
     * Fetches the first record matching a filter string.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {string} filter PocketBase filter expression string.
     * @param {RecordOptions} [options={}] Query parameters.
     * @returns {Promise<T>} The first matching record.
     */
    async getFirst (collection, filter, options = {}) {
      return await pb.collection(collection).getFirstListItem(filter, options)
    },

    /**
     * Creates a new record in a collection.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {Object|FormData} data Record fields or FormData instance.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<T>} The newly created record instance.
     */
    async create (collection, data, options = {}) {
      return await pb.collection(collection).create(data, options)
    },

    /**
     * Updates an existing record by ID.
     *
     * @template {RecordModel} T
     * @param {string} collection Collection name.
     * @param {string} id Unique record ID to update.
     * @param {Object|FormData} data Fields to update.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<T>} The updated record instance.
     */
    async update (collection, id, data, options = {}) {
      return await pb.collection(collection).update(id, data, options)
    },

    /**
     * Deletes a record by ID.
     *
     * @param {string} collection Collection name.
     * @param {string} id Unique record ID to delete.
     * @param {RecordOptions} [options={}] Query options.
     * @returns {Promise<boolean>} Resolves true upon successful deletion.
     */
    async delete (collection, id, options = {}) {
      return await pb.collection(collection).delete(id, options)
    }
  }
}
