import { definePlugin } from 'coralite'

export default definePlugin({
  name: 'emojiPicker',
  client: {
    context: (_pluginContext) => {
      const $emojiPicker = {
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

            picker.dataSource = options.dataSource || '/assets/emoji-en.json'

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
