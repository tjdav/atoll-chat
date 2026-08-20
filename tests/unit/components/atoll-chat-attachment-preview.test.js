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

    const coverBtn = el.querySelector('[data-testid$="btn-change-cover"]')
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

    const coverBtn = el.querySelector('[data-testid$="btn-change-cover"]')
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

  test('should render multiple attachments (media cards and document pills) using attachments property', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      {
        id: 'item-1',
        fileName: 'photo.png',
        isImage: true,
        thumbnailPreviewUrl: 'blob:http://localhost/photo-blob'
      },
      {
        id: 'item-2',
        fileName: 'report.pdf',
        fileSize: 2097152
      }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const mediaTile = el.querySelector('[data-testid$="media-tile-item-1"]')
    assert.ok(mediaTile, 'Media card tile should be rendered')

    const docPill = el.querySelector('[data-testid$="document-pill-item-2"]')
    assert.ok(docPill, 'Document pill should be rendered')

    const sizeSubtext = docPill.querySelector('.atoll-chip-subtext')
    assert.ok(sizeSubtext)
    assert.equal(sizeSubtext.textContent.trim(), '2.0 MB')

    const counter = el.querySelector('.atoll-add-more-counter')
    assert.ok(counter)
    assert.equal(counter.textContent.trim(), '2/10')
  })

  test('should hide Add More tile when attachments quota reaches 10', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const tenItems = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      fileName: `file-${i}.txt`,
      fileSize: 1024
    }))

    el.attachments = tenItems
    await new Promise(resolve => setTimeout(resolve, 20))

    const addMoreTile = el.querySelector('[data-testid$="add-more-tile"]')
    assert.ok(addMoreTile)
    assert.equal(addMoreTile.hidden, true, 'Add More tile should be hidden when quota is 10')

    const counter = el.querySelector('.atoll-add-more-counter')
    assert.equal(counter.textContent.trim(), '10/10')
  })

  test('should emit ui:files_selected on Add More file input change', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const addMoreInput = el.querySelector('[data-testid$="add-more-file-input"]')
    assert.ok(addMoreInput)

    const testFile = new File(['test content'], 'sample.pdf', { type: 'application/pdf' })
    Object.defineProperty(addMoreInput, 'files', {
      value: [testFile],
      configurable: true
    })

    addMoreInput.dispatchEvent(new Event('change'))

    const emitted = emittedEvents.find(e => e.event === 'ui:files_selected')
    assert.ok(emitted, 'ui:files_selected event should be emitted on $bus')
    assert.equal(emitted.payload.files.length, 1)
    assert.equal(emitted.payload.files[0].name, 'sample.pdf')
  })

  test('should emit ui:remove_attachment when close button is clicked on multi-attachment item', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      {
        id: 'att-101',
        fileName: 'doc1.pdf'
      },
      {
        id: 'att-102',
        fileName: 'doc2.pdf'
      }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const removeBtn = el.querySelector('[data-testid$="btn-remove-att-101"]')
    assert.ok(removeBtn)

    const innerBtn = removeBtn.querySelector('button') || removeBtn
    innerBtn.click()

    const emitted = emittedEvents.find(e => e.event === 'ui:remove_attachment')
    assert.ok(emitted, 'ui:remove_attachment event should be emitted on $bus')
    assert.equal(emitted.payload.id, 'att-101')
  })

  test('should emit ui:attachment_cover_selected when selecting cover for video item', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      {
        id: 'vid-01',
        isVideo: true,
        fileName: 'my-video.mp4'
      }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const coverInput = el.querySelector('[data-testid$="cover-file-input"]')
    assert.ok(coverInput)

    const coverFile = new File(['cover img'], 'cover.jpg', { type: 'image/jpeg' })
    Object.defineProperty(coverInput, 'files', {
      value: [coverFile],
      configurable: true
    })

    const coverBtn = el.querySelector('[data-testid$="btn-change-cover"]')
    assert.ok(coverBtn)
    coverBtn.click()

    coverInput.dispatchEvent(new Event('change'))

    const emitted = emittedEvents.find(e => e.event === 'ui:attachment_cover_selected')
    assert.ok(emitted, 'ui:attachment_cover_selected event should be emitted on $bus')
    assert.equal(emitted.payload.id, 'vid-01')
    assert.equal(emitted.payload.file.name, 'cover.jpg')
  })

  test('should render processing and error overlays and emit ui:retry_attachment_processing on error tile click', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      {
        id: 'proc-item',
        isImage: true,
        isCompressing: true,
        progress: 60,
        status: 'Compressing image...'
      },
      {
        id: 'err-item',
        isImage: true,
        isError: true,
        errorMessage: 'Failed to compress'
      }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const procOverlay = el.querySelector('[data-testid$="processing-overlay-proc-item"]')
    assert.ok(procOverlay, 'Processing overlay should be rendered')
    assert.ok(procOverlay.textContent.includes('60%'))

    const errOverlay = el.querySelector('[data-testid$="error-overlay-err-item"]')
    assert.ok(errOverlay, 'Error overlay should be rendered')
    assert.ok(errOverlay.textContent.includes('Failed to compress'))

    const errTile = el.querySelector('[data-testid$="media-tile-err-item"]')
    assert.ok(errTile)
    errTile.click()

    const emitted = emittedEvents.find(e => e.event === 'ui:retry_attachment_processing')
    assert.ok(emitted, 'ui:retry_attachment_processing event should be emitted on $bus')
    assert.equal(emitted.payload.id, 'err-item')
  })

  test('should emit ui:attachment_cover_removed when custom cover remove action is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      {
        id: 'vid-custom',
        isVideo: true,
        isCustomCover: true,
        fileName: 'my-custom-video.mp4'
      }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const coverBtn = el.querySelector('[data-testid$="btn-change-cover"]')
    assert.ok(coverBtn)
    assert.ok(coverBtn.classList.contains('is-custom'))

    coverBtn.click()

    const emitted = emittedEvents.find(e => e.event === 'ui:attachment_cover_removed')
    assert.ok(emitted, 'ui:attachment_cover_removed event should be emitted on $bus')
    assert.equal(emitted.payload.id, 'vid-custom')
  })

  test('Test 1: should render multiple mixed items (2 images, 1 video, 1 document) simultaneously in the rail', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      { id: 'img-1', isImage: true, fileName: 'pic1.jpg', fileSize: 1048576, status: 'Ready to send' },
      { id: 'img-2', isImage: true, fileName: 'pic2.png', fileSize: 2097152, status: 'Ready to send' },
      { id: 'vid-1', isVideo: true, fileName: 'clip.mp4', fileSize: 5242880, status: 'Ready to send' },
      { id: 'doc-1', fileName: 'summary.pdf', fileSize: 512000, status: 'Ready to send' }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const tile1 = el.querySelector('[data-testid$="media-tile-img-1"]')
    const tile2 = el.querySelector('[data-testid$="media-tile-img-2"]')
    const tile3 = el.querySelector('[data-testid$="media-tile-vid-1"]')
    const pill = el.querySelector('[data-testid$="document-pill-doc-1"]')

    assert.ok(tile1, 'First image tile should exist')
    assert.ok(tile2, 'Second image tile should exist')
    assert.ok(tile3, 'Video tile should exist')
    assert.ok(pill, 'Document pill should exist')

    assert.equal(tile1.getAttribute('tabindex'), '0')
    assert.equal(tile1.getAttribute('aria-label'), 'Attachment 1: pic1.jpg, 1.0 MB, Ready to send')
    assert.equal(pill.getAttribute('tabindex'), '0')
    assert.equal(pill.getAttribute('aria-label'), 'Attachment 4: summary.pdf, 500 KB, Ready to send')
  })

  test('Test 2: should render video card with cover edit button and bottom-left video indicator', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      { id: 'video-card', isVideo: true, fileName: 'test-video.mp4', fileSize: 15728640 }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const tile = el.querySelector('[data-testid$="media-tile-video-card"]')
    assert.ok(tile)

    const videoBadge = tile.querySelector('.atoll-chat-tile-video-badge')
    assert.ok(videoBadge, 'Bottom-left video indicator badge should be rendered')

    const coverBtn = tile.querySelector('[data-testid$="btn-change-cover"]')
    assert.ok(coverBtn, 'Cover change button should be rendered')
    assert.equal(coverBtn.textContent.trim(), 'Change Cover')
  })

  test('Test 3: should render document pill with filename, filesize, and remove button', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      { id: 'doc-card', fileName: 'financial_report.xlsx', fileSize: 3145728 }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const pill = el.querySelector('[data-testid$="document-pill-doc-card"]')
    assert.ok(pill)

    const filenameEl = pill.querySelector('.atoll-chip-filename')
    assert.ok(filenameEl)
    assert.equal(filenameEl.textContent.trim(), 'financial_report.xlsx')

    const filesizeEl = pill.querySelector('.atoll-chip-subtext')
    assert.ok(filesizeEl)
    assert.equal(filesizeEl.textContent.trim(), '3.0 MB')

    const removeBtn = pill.querySelector('[data-testid$="btn-remove-doc-card"]')
    assert.ok(removeBtn)
  })

  test('Test 4: should render processing overlay and progress bar when isCompressing is true', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      { id: 'comp-item', isVideo: true, isCompressing: true, progress: 75, status: 'Compressing...' }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const overlay = el.querySelector('[data-testid$="processing-overlay-comp-item"]')
    assert.ok(overlay)
    assert.ok(overlay.textContent.includes('75%'))
  })

  test('Test 5: should emit ui:remove_attachment with { id: "target-id" } when clicking a specific item remove button', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      { id: 'target-id', fileName: 'sample.pdf' }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const removeBtn = el.querySelector('[data-testid$="btn-remove-target-id"]')
    assert.ok(removeBtn)

    const innerBtn = removeBtn.querySelector('button') || removeBtn
    innerBtn.click()

    const emitted = emittedEvents.find(e => e.event === 'ui:remove_attachment')
    assert.ok(emitted)
    assert.equal(emitted.payload.id, 'target-id')
  })

  test('Test 6: should emit ui:attachment_cover_selected with correct { id: "video-2", file } when changing cover on a specific video', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      { id: 'video-1', isVideo: true, fileName: 'v1.mp4' },
      { id: 'video-2', isVideo: true, fileName: 'v2.mp4' }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const coverInput = el.querySelector('[data-testid$="cover-file-input"]')
    assert.ok(coverInput)

    const tile2 = el.querySelector('[data-testid$="media-tile-video-2"]')
    const coverBtn = tile2.querySelector('[data-testid$="btn-change-cover"]')
    assert.ok(coverBtn)
    coverBtn.click()

    const newCoverFile = new File(['thumb payload'], 'new-cover.jpg', { type: 'image/jpeg' })
    Object.defineProperty(coverInput, 'files', {
      value: [newCoverFile],
      configurable: true
    })

    coverInput.dispatchEvent(new Event('change'))

    const emitted = emittedEvents.find(e => e.event === 'ui:attachment_cover_selected')
    assert.ok(emitted)
    assert.equal(emitted.payload.id, 'video-2')
    assert.equal(emitted.payload.file.name, 'new-cover.jpg')
  })

  test('Test 7: should hide Add More tile when attachments.length >= 10', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = Array.from({ length: 10 }, (_, i) => ({
      id: `att-${i}`,
      fileName: `file-${i}.txt`
    }))

    await new Promise(resolve => setTimeout(resolve, 20))

    const addMoreTile = el.querySelector('[data-testid$="add-more-tile"]')
    assert.ok(addMoreTile)
    assert.equal(addMoreTile.hidden, true)
  })

  test('Test 8: should remove focused attachment when Backspace or Delete key is pressed', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    el.attachments = [
      { id: 'del-item-1', fileName: 'file1.pdf' },
      { id: 'del-item-2', fileName: 'file2.pdf' }
    ]

    await new Promise(resolve => setTimeout(resolve, 20))

    const pill1 = el.querySelector('[data-testid$="document-pill-del-item-1"]')
    assert.ok(pill1)

    pill1.focus()

    const backspaceEvent = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    pill1.dispatchEvent(backspaceEvent)

    const emitted = emittedEvents.find(e => e.event === 'ui:remove_attachment')
    assert.ok(emitted, 'ui:remove_attachment should be emitted on Backspace keydown')
    assert.equal(emitted.payload.id, 'del-item-1')
  })
})
