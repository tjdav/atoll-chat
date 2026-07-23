import { definePlugin } from 'coralite'

/**
 * Markdown Plugin for Coralite
 * Provides asynchronous marked parsing and DOMPurify sanitization.
 */
export default definePlugin({
  name: 'markdown',
  client: {
    name: 'markdown',
    context: () => {
      let markdownPromise = null

      const getLibs = () => {
        if (!markdownPromise) {
          markdownPromise = Promise.all([
            import('marked'),
            import('isomorphic-dompurify')
          ]).then(([m, d]) => {
            const marked = m.marked || m
            const DOMPurify = d.default || d
            if (marked.setOptions) {
              marked.setOptions({
                breaks: true,
                gfm: true
              })
            }
            return {
              marked,
              DOMPurify
            }
          })
        }
        return markdownPromise
      }

      const $markdown = {
        /**
         * Parses and sanitizes a markdown string into clean HTML.
         * @param {string} content - Markdown input text.
         * @returns {Promise<string>} Sanitized HTML string.
         */
        render: async (content) => {
          if (!content) {
            return ''
          }
          const { marked, DOMPurify } = await getLibs()
          const rawHtml = await marked.parse(content)
          return DOMPurify.sanitize(rawHtml)
        },
        getLibs
      }

      return () => {
        return {
          $markdown,
          renderMarkdown: $markdown.render
        }
      }
    }
  }
})
