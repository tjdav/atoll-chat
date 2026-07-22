/**
 * @import PocketBase, { RecordSubscription, RecordSubscribeOptions } from 'pocketbase'
 */

/**
 * Creates the PocketBase Realtime Subscription Abstraction API.
 * Encapsulates real-time event topics and callback listeners.
 *
 * @param {PocketBase} pb PocketBase SDK client instance.
 * @returns {Object} Realtime API helper methods.
 */
export function createRealtimeApi (pb) {
  return {
    /**
     * Subscribes to realtime SSE events for a collection and topic.
     *
     * @param {string} collection Collection name.
     * @param {string} topic Subscription topic (e.g. '*' or record ID).
     * @param {function(RecordSubscription): void} callback Event listener function.
     * @param {RecordSubscribeOptions} [options={}] Additional subscription options.
     * @returns {Promise<function(): Promise<void>>} Unsubscribe function.
     */
    async subscribe (collection, topic, callback, options = {}) {
      return await pb.collection(collection).subscribe(topic, callback, options)
    },

    /**
     * Unsubscribes from realtime SSE events for a collection and topic.
     *
     * @param {string} collection Collection name.
     * @param {string} [topic='*'] Subscription topic to unsubscribe from.
     * @returns {Promise<boolean|void>} Resolves when unsubscribed.
     */
    async unsubscribe (collection, topic) {
      return await pb.collection(collection).unsubscribe(topic)
    }
  }
}
