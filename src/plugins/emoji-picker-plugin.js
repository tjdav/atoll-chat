import { definePlugin } from 'coralite'

/**
 * Emoji Picker Plugin for Atoll Chat.
 * Provides a factory for creating emoji-picker-element instances with custom data support.
 */
export default function emojiPickerPlugin () {
  return definePlugin({
    name: 'emojiPicker',
    client: {
      context: (pluginContext) => {
        console.log('[emojiPickerPlugin] Initializing context')
        const $emojiPicker = {
          createPicker: async (options = {}) => {
            console.log('[emojiPickerPlugin] createPicker called')
            // Dynamically import emoji-picker-element
            try {
              // Ensure we are in a browser environment
              if (typeof window !== 'undefined') {
                await import('emoji-picker-element')
                console.log('[emojiPickerPlugin] emoji-picker-element imported')

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
            } catch (err) {
              console.error('[emojiPickerPlugin] Failed to import emoji-picker-element:', err)
              throw err
            }
          }
        }

        return () => {
          return {
            $emojiPicker
          }
        }
      }
    }
  })
}
