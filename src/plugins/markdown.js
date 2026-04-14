import { definePlugin } from 'coralite'
export default definePlugin({
  name: 'markdown-plugin',
  client: {
    imports: [{
      specifier: 'https://esm.sh/marked@14.1.2',
      namedExports: ['marked']
    }],
    helpers: {
      parseMessage: async globalContext => {
        const {
          marked
        } = globalContext.imports
        if (!window.DOMPurify) {
          await import('https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.7/purify.min.js')
        }
        return localContext => (element, text) => {
          // If the text contains the raw slot from initial render, don't parse it yet

          if (text.includes('<slot></slot>')) {
            return
          }
          const html = marked.parse(text)
          if (window.DOMPurify) {
            element.innerHTML = window.DOMPurify.sanitize(html)
          } else if (typeof element.setHTML === 'function') {
            try {
              element.setHTML(html)
            } catch (event) {
              // Strictly safe fallback if setHTML throws an error and DOMPurify is not available

              element.textContent = text
            }
          } else {
            // Strictly safe fallback

            element.textContent = text
          }
        }
      }
    }
  }
})
