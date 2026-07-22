/**
 * @import PocketBase, { RecordModel, FileOptions } from 'pocketbase'
 */

/**
 * Creates the PocketBase File & Media URL Abstraction API.
 * Encapsulates record file attachment URL generation.
 *
 * @param {PocketBase} pb PocketBase SDK client instance.
 * @returns {Object} File API helper methods.
 */
export function createFileApi (pb) {
  return {
    /**
     * Constructs a full public or authenticated asset URL for a record file field.
     *
     * @param {RecordModel} record Record instance containing the file field.
     * @param {string} filename File field value (filename string).
     * @param {FileOptions} [options={}] Image thumb size or download query options.
     * @returns {string} Generated HTTP URL string for the file asset.
     */
    getUrl (record, filename, options = {}) {
      if (!record || !filename) {
        return ''
      }

      return pb.files.getURL(record, filename, options)
    },

    /**
     * Constructs a full public or authenticated asset URL for a record file field.
     *
     * @param {RecordModel} record Record instance containing the file field.
     * @param {string} filename File field value (filename string).
     * @param {FileOptions} [options={}] Image thumb size or download query options.
     * @returns {string} Generated HTTP URL string for the file asset.
     */
    getURL (record, filename, options = {}) {
      if (!record || !filename) {
        return ''
      }

      return pb.files.getURL(record, filename, options)
    }
  }
}
