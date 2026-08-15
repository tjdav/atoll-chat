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
      let highlightPromise = null

      const getLibs = (hasCode) => {
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

        if (hasCode) {
          if (!highlightPromise) {
            highlightPromise = import('highlight.js').then(m => m.default || m)
          }
          return Promise.all([markdownPromise, highlightPromise]).then(([{ marked, DOMPurify }, hljs]) => {
            return {
              marked,
              DOMPurify,
              hljs
            }
          })
        }

        return markdownPromise.then(({ marked, DOMPurify }) => {
          return {
            marked,
            DOMPurify,
            hljs: null
          }
        })
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
            const escaped = content
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
            return `<p>${escaped}</p>`
          }
          const hasCode = content.includes('```')
          const { marked, DOMPurify, hljs } = await getLibs(hasCode)

          const options = {}
          if (hljs) {
            options.renderer = {
              code ({ text, lang }) {
                let highlightedText = text
                if (lang && hljs.getLanguage(lang)) {
                  try {
                    highlightedText = hljs.highlight(text, { language: lang }).value
                  } catch {
                    // Fallback to text
                  }
                } else {
                  try {
                    highlightedText = hljs.highlightAuto(text).value
                  } catch {
                    // Fallback to text
                  }
                }
                const cleanLang = lang ? lang.replace(/[^\w-]/g, '') : ''
                const classAttr = cleanLang ? `hljs language-${cleanLang}` : 'hljs'
                return `<pre><code class="${classAttr}">${highlightedText}</code></pre>`
              }
            }
          }

          const rawHtml = await marked.parse(content, options)
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
