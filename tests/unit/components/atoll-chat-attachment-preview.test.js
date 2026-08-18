import test, { describe, beforeEach, before } from 'node:test'
import assert from 'node:assert'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Attachment Preview Component', () => {
  let tagName
  let element
  const emittedEvents = []
  const busListeners = new Map()

  const mockEventBus = {
    $bus: {
      emit: (event, payload) => {
        emittedEvents.push({
          event,
          payload
        })
        const listeners = busListeners.get(event)
        if (listeners) {
          listeners.forEach(cb => cb(payload))
        }
      },
      on: (event, cb) => {
        if (!busListeners.has(event)) {
          busListeners.set(event, new Set())
        }
        busListeners.get(event).add(cb)
      },
      off: (event, cb) => {
        if (busListeners.has(event)) {
          if (cb) {
            busListeners.get(event).delete(cb)
          } else {
            busListeners.delete(event)
          }
        }
      }
    }
  }

  before(async () => {
    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    tagName = await loadComponent('atoll-chat-attachment-preview', { eventBus: mockEventBus })
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    emittedEvents.length = 0
    busListeners.clear()
    element = document.createElement(tagName)
  })

  test('should render horizontal reel and "Add More" tile when attachments < 10', async () => {
    document.body.appendChild(element)
    await new Promise(res => setTimeout(res, 20))

    const attachments = [
      {
        id: '1',
        fileName: 'photo1.jpg',
        fileSize: 102400,
        isImage: true,
        thumbnailPreviewUrl: 'blob:http://localhost/1'
      },
      {
        id: '2',
        fileName: 'doc1.pdf',
        fileSize: 204800,
        isImage: false,
        isVideo: false
      }
    ]
    mockEventBus.$bus.emit('ui:attachments_updated', { attachments })
    await new Promise(res => setTimeout(res, 20))

    const addMoreTile = element.querySelector('[data-testid="add-more-tile"]')
    assert.ok(addMoreTile)

    const tiles = element.querySelectorAll('.atoll-chat-attachment-tile')
    assert.strictEqual(tiles.length, 1)

    const chips = element.querySelectorAll('.atoll-chat-attachment-chip')
    assert.strictEqual(chips.length, 1)
  })

  test('should hide "Add More" tile when attachments reach 10 items', async () => {
    document.body.appendChild(element)
    await new Promise(res => setTimeout(res, 20))

    const attachments = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      fileName: `file${i}.png`,
      isImage: true,
      thumbnailPreviewUrl: `blob:http://localhost/${i}`
    }))
    mockEventBus.$bus.emit('ui:attachments_updated', { attachments })
    await new Promise(res => setTimeout(res, 20))

    const addMoreTile = element.querySelector('[data-testid="add-more-tile"]')
    assert.ok(addMoreTile)
    assert.strictEqual(addMoreTile.hidden || addMoreTile.hasAttribute('hidden'), true)
  })

  test('should emit ui:remove_attachment when remove button is clicked', async () => {
    document.body.appendChild(element)
    await new Promise(res => setTimeout(res, 20))

    const attachments = [
      {
        id: 'att-123',
        fileName: 'file.png',
        isImage: true,
        thumbnailPreviewUrl: 'blob:http://localhost/1'
      }
    ]
    mockEventBus.$bus.emit('ui:attachments_updated', { attachments })
    await new Promise(res => setTimeout(res, 20))

    const removeBtn = element.querySelector('[data-testid="btn-remove-attachment-att-123"]')
    assert.ok(removeBtn)

    removeBtn.click()

    assert.strictEqual(emittedEvents.some(e => e.event === 'ui:remove_attachment' && e.payload.id === 'att-123'), true)
  })
})
