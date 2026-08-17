import { Window } from 'happy-dom'

const window = new Window({
  url: 'http://localhost'
})

// Polyfill ResizeObserver for unit tests if not present
if (window.ResizeObserver === undefined) {
  window.ResizeObserver = class ResizeObserver {
    observe () {
    }
    unobserve () {
    }
    disconnect () {
    }
  }
}

if (!window.indexedDB) {
  window.indexedDB = {
    open () {
      return {
        addEventListener () {
        },
        removeEventListener () {
        }
      }
    }
  }
}

const props = [
  'window',
  'document',
  'customElements',
  'Element',
  'HTMLElement',
  'HTMLImageElement',
  'Image',
  'HTMLTemplateElement',
  'Node',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'MutationObserver',
  'localStorage',
  'sessionStorage',
  'navigator',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'DOMParser',
  'Blob',
  'FileReader',
  'ResizeObserver',
  'indexedDB'
]

for (const prop of props) {
  if (window[prop] !== undefined) {
    try {
      Object.defineProperty(globalThis, prop, {
        value: window[prop],
        configurable: true,
        writable: true
      })
    } catch (_e) {
      try {
        globalThis[prop] = window[prop]
      } catch (_err) {
        // Ignored
      }
    }
  }
}

if (!globalThis.Image && globalThis.HTMLImageElement) {
  globalThis.Image = globalThis.HTMLImageElement
}

globalThis.self = globalThis

if (!globalThis.document.body) {
  const body = globalThis.document.createElement('body')
  globalThis.document.documentElement.appendChild(body)
}
