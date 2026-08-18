import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Attachment Preview Component', () => {
  let tagName
  let emittedEvents

  const mockBus = {
    $bus: {
      emit: (event, payload) => {
        emittedEvents.push({
          event,
          payload
        })
      },
      on: () => {
      },
      off: () => {
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents = []
    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    tagName = await loadComponent('atoll-chat-attachment-preview', {
      eventBus: mockBus
    })
  })

  test('should render base document attachment preview', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('file-name', 'document.pdf')
    el.setAttribute('upload-status', 'Ready to send')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const nameEl = el.querySelector('.atoll-chat-attachment-preview-name')
    const statusEl = el.querySelector('.atoll-chat-attachment-preview-status')
    assert.ok(nameEl)
    assert.equal(nameEl.textContent.trim(), 'document.pdf')
    assert.ok(statusEl)
    assert.equal(statusEl.textContent.trim(), 'Ready to send')

    const genericIcon = el.querySelector('atoll-icon[name="document"]')
    assert.ok(genericIcon)
    assert.equal(genericIcon.hasAttribute('hidden'), false)

    const thumbContainer = el.querySelector('.atoll-chat-attachment-preview-thumbnail-container')
    assert.ok(thumbContainer)
    assert.equal(thumbContainer.hasAttribute('hidden'), true)
  })

  test('should render image thumbnail preview with proper tile class when thumbnailUrl is provided', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('file-name', 'photo.jpg')
    el.setAttribute('upload-status', 'Ready to send')
    el.setAttribute('thumbnail-url', 'blob:http://localhost/mock-image-blob')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const thumbContainer = el.querySelector('.atoll-chat-attachment-preview-thumbnail-container')
    assert.ok(thumbContainer)
    assert.equal(thumbContainer.hasAttribute('hidden'), false)
    assert.ok(thumbContainer.classList.contains('atoll-chat-attachment-tile'), 'Thumbnail container should have atoll-chat-attachment-tile class')

    const img = thumbContainer.querySelector('img')
    assert.ok(img)
    assert.equal(img.hasAttribute('hidden'), false)
    assert.ok(img.src.includes('mock-image-blob'))

    const coverBtn = el.querySelector('[data-testid="btn-change-cover"]')
    assert.ok(coverBtn)
    assert.equal(coverBtn.hasAttribute('hidden'), true, 'Change cover button should be hidden for image attachments')

    const genericIcon = el.querySelector('atoll-icon[name="document"]')
    assert.ok(genericIcon)
    assert.equal(genericIcon.hasAttribute('hidden'), true)
  })

  test('should render video attachment preview with cover change button and tile styling', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('file-name', 'video.mp4')
    el.setAttribute('upload-status', 'Processing video...')
    el.setAttribute('is-video', 'true')
    el.setAttribute('thumbnail-url', 'blob:http://localhost/mock-video-thumb')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const thumbContainer = el.querySelector('.atoll-chat-attachment-preview-thumbnail-container')
    assert.ok(thumbContainer)
    assert.equal(thumbContainer.hasAttribute('hidden'), false)

    const coverBtn = el.querySelector('[data-testid="btn-change-cover"]')
    assert.ok(coverBtn)
    assert.equal(coverBtn.hasAttribute('hidden'), false, 'Change cover button should be visible for videos')
    assert.ok(coverBtn.classList.contains('atoll-chat-tile-cover-btn'), 'Cover button should include atoll-chat-tile-cover-btn class')
    assert.equal(coverBtn.textContent.trim(), 'Change Cover')

    // Change to custom cover
    el.setAttribute('is-custom', 'true')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(coverBtn.textContent.trim(), 'Remove Custom Cover')
  })

  test('should display progress bar when compressing or uploading', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('file-name', 'large-video.mp4')
    el.setAttribute('upload-status', 'Compressing video...')
    el.setAttribute('is-compressing', 'true')
    el.setAttribute('progress', '45')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const progressWrapper = el.querySelector('.atoll-chat-attachment-preview-progress')
    assert.ok(progressWrapper)
    assert.equal(progressWrapper.hasAttribute('hidden'), false)

    const progressBar = progressWrapper.querySelector('.progress-bar')
    assert.ok(progressBar)
    assert.equal(progressBar.style.width, '45%')
  })

  test('should emit ui:cancel event bus signal when cancel button is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const cancelBtn = el.querySelector('atoll-button')
    assert.ok(cancelBtn)

    const innerBtn = cancelBtn.querySelector('button') || cancelBtn
    innerBtn.click()

    const emitted = emittedEvents.find(e => e.event === 'ui:cancel')
    assert.ok(emitted, 'ui:cancel should be emitted on bus')
  })

  test('should clear thumbnail image src on image load error', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('thumbnail-url', 'blob:http://localhost/invalid-blob-url')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const img = el.querySelector('.atoll-chat-attachment-preview-thumbnail-container img')
    assert.ok(img)
    assert.ok(img.src.includes('invalid-blob-url'))

    img.dispatchEvent(new Event('error'))
    assert.equal(img.getAttribute('src'), '')
  })
})
