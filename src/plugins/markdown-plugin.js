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
          /* Fast path: single-line plain text. Marked would render this as a single <p>, so we do
             the same synchronously and skip importing marked + DOMPurify entirely (costly when
             rendering thousands of rows). Anything containing markdown syntax or a bare URL
             still goes through the parser so formatting and autolinking are unchanged. */
          const needsMarked = /[*_`#<>&\n[\]()]|:\/\//.test(content) || /www\./.test(content)
          if (!needsMarked) {
            return `<p>${content}</p>`
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
