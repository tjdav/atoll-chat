import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Timeline Item Voice Component', () => {
  let tagName
  let busListeners
  let mockBus

  beforeEach(async () => {
    document.body.innerHTML = ''
    busListeners = new Map()

    mockBus = {
      emit: (event, payload) => {
        const listeners = busListeners.get(event) || []
        for (const fn of listeners) {
          fn(payload)
        }
      },
      on: (event, fn) => {
        if (!busListeners.has(event)) {
          busListeners.set(event, [])
        }
        busListeners.get(event).push(fn)
        return () => {
          const arr = busListeners.get(event) || []
          const idx = arr.indexOf(fn)
          if (idx !== -1) {
            arr.splice(idx, 1)
          }
        }
      },
      off: () => {
      }
    }

    if (!customElements.get('atoll-icon')) {
      customElements.define('atoll-icon', class extends HTMLElement {
      })
    }

    tagName = await loadComponent('atoll-chat-timeline-item-voice', {
      eventBus: {
        $bus: mockBus
      },
      globalStore: {
        $state: {
          decryptionCache: new Map(),
          subscribe: () => () => {
          }
        }
      },
      storage: {
        $storage: {
          getMessage: async () => null,
          getFile: async () => null
        }
      }
    })
  })

  test('should safely render transcription error messages as plain text without executing XSS', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('local-uuid', 'msg-123')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const xssPayload = '<img src=x onerror=alert(1)><script>window.xssInjected=true</script>'

    mockBus.emit('transcription:state_change', {
      localUuid: 'msg-123',
      state: 'error',
      error: xssPayload
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    const transcriptionArea = el.querySelector('.transcription-area')
    assert.ok(transcriptionArea, 'Transcription area should exist')

    // Check that no img or script tags were created inside the transcription area
    const injectedImg = transcriptionArea.querySelector('img')
    const injectedScript = transcriptionArea.querySelector('script')
    assert.equal(injectedImg, null, 'XSS payload <img> tag should not be rendered as HTML element')
    assert.equal(injectedScript, null, 'XSS payload <script> tag should not be rendered as HTML element')

    // Check that textContent contains the escaped plain text error message
    assert.ok(transcriptionArea.textContent.includes(xssPayload), 'XSS payload text should be safely rendered as plain text')
  })
})
