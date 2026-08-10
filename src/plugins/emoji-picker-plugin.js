import { definePlugin } from 'coralite'

/**
 * Emoji Picker Plugin for Atoll Chat.
 * Provides a gateway client context with a factory helper to dynamically import
 * and instantiate the 'emoji-picker-element' component.
 */
export default definePlugin({
  name: 'emojiPicker',
  client: {
    /**
     * Initializes the emoji picker plugin client context using the Two-Phase Resolver pattern.
     *
     * @param {Object} _pluginContext - The global plugin context.
     * @returns {function(Object): Object} A function that resolves the component-level instance context.
     */
    context: (_pluginContext) => {
      /**
       * Interface for interacting with the emoji picker element.
       */
      const $emojiPicker = {
        /**
         * Dynamically imports the emoji-picker-element library and instantiates
         * a new custom emoji-picker element.
         *
         * @param {Object} [options={}] - Custom configuration options for the picker.
         * @param {Array<Object>} [options.customEmoji] - Array of custom emoji definitions.
         * @param {Object} [options.i18n] - Custom internationalization strings.
         * @param {string} [options.dataSource] - URL to an alternative emoji data source.
         * @returns {Promise<HTMLElement|null>} A promise resolving to the created emoji-picker element, or null if not in a browser environment.
         * @throws {Error} Re-throws unexpected dynamic import/network failure errors.
         */
        createPicker: async (options = {}) => {
          if (typeof window !== 'undefined') {
            await import('emoji-picker-element')

            const picker = document.createElement('emoji-picker')

            if (options.customEmoji) {
              picker.customEmoji = options.customEmoji
            }

            if (options.i18n) {
              picker.i18n = options.i18n
            }

            if (options.dataSource) {
              picker.dataSource = options.dataSource
            }

            return picker
          }
          return null
        }
      }

      return (_instanceContext) => {
        return {
          $emojiPicker
        }
      }
    }
  }
})
