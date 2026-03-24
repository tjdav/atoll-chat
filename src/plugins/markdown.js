import { createPlugin } from 'coralite'

export default createPlugin({
  name: 'markdown-plugin',
  client: {
    imports: [
      {
        specifier: 'https://esm.sh/marked@14.1.2',
        namedExports: ['marked']
      }
    ],
    helpers: {
      parseMessage: async (globalContext) => {
        const { marked } = globalContext.imports

        // Fallback if setHTML is not supported
        if (typeof document.documentElement.setHTML !== 'function' && !window.DOMPurify) {
          await import('https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.7/purify.min.js')
        }

        return () => (element, text) => {
          const html = marked.parse(text)

          if (window.DOMPurify) {
            element.innerHTML = html
          } else {
            element.setHTML(html)
          }
        }
      }
    }
  }
})
