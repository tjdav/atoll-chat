import { test, describe, beforeEach, before } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Chat Input Component - Media Conversion & Send Failure Handling', () => {
  let tagName

  // Suite-level persistent mutable singletons
  const busListeners = {}
  const emittedEvents = []
  const savedMessages = []
  const deletedRecords = []
  const decryptionCache = new Map()

  const globalState = {
    currentMessageText: '',
    activeSelectionId: 'room123',
    currentUser: { id: 'user1' },
    isOnline: true,
    decryptionCache,
    subscribe: () => () => {
    }
  }

  let mediaBehavior = {}
  let configMaxServerUpload = 26214400
  let roomParticipantsCount = 2
  let workerSendMessageError = null

  const mockMedia = {
    checkCompatibility: async (file) => {
      if (mediaBehavior.checkCompatibility) {
        return mediaBehavior.checkCompatibility(file)
      }
      if (file.name.endsWith('.mkv') || file.name.endsWith('.mov') || file.name.endsWith('.heic') || file.name.endsWith('.wav')) {
        const category = file.name.endsWith('.heic') ? 'image' : file.name.endsWith('.wav') ? 'audio' : 'video'
        return {
          requiresConversion: true,
          category
        }
      }
      return {
        requiresConversion: false,
        category: 'none'
      }
    },
    compressVideo: async (file, options) => {
      if (mediaBehavior.compressVideo) {
        return mediaBehavior.compressVideo(file, options)
      }
      if (file.name.includes('fail')) {
        throw new Error('Transcoding/Compression error')
      }
      return new File(['converted_video'], 'video.mp4', { type: 'video/mp4' })
    },
    evaluateVideo: async (file, options) => {
      if (mediaBehavior.evaluateVideo) {
        return mediaBehavior.evaluateVideo(file, options)
      }
      if (file.name.includes('oversized') || file.size > (options.maxServerUploadSizeBytes || 26214400)) {
        return {
          shouldCompress: true,
          useWebRTC: false,
          targetBitrate: 1000000
        }
      }
      return {
        shouldCompress: false,
        useWebRTC: false
      }
    },
    extractThumbnail: async (file) => {
      if (mediaBehavior.extractThumbnail) {
        return mediaBehavior.extractThumbnail(file)
      }
      return {
        thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
        duration: 10
      }
    },
    compressImage: async (file, options) => {
      if (mediaBehavior.compressImage) {
        return mediaBehavior.compressImage(file, options)
      }
      if (file.name.includes('fail_image')) {
        throw new Error('Image compression error')
      }
      return new Blob(['compressed_img'], { type: 'image/webp' })
    },
    convertAudio: async (file) => {
      if (mediaBehavior.convertAudio) {
        return mediaBehavior.convertAudio(file)
      }
      if (file.name.includes('fail_audio')) {
        throw new Error('Audio conversion error')
      }
      return new File(['converted_audio'], 'audio.m4a', { type: 'audio/mp4' })
    },
    generateWaveform: async () => 'data:image/svg+xml;utf8,<svg></svg>'
  }

  const mockConfig = {
    get: (key) => (key === 'maxServerUploadSizeBytes' ? configMaxServerUpload : null)
  }

  const mockStorage = {
    saveMessage: async (msg) => {
      savedMessages.push(msg)
    },
    getRoom: async (roomId) => {
      const participants = Array.from({ length: roomParticipantsCount }, (_, i) => ({ id: `user${i + 1}` }))
      return {
        id: roomId,
        participants
      }
    },
    deleteRecord: async (collection, id) => {
      deletedRecords.push({
        collection,
        id
      })
    }
  }

  const mockWorker = {
    execute: async (cmd, payload) => {
      if (cmd === 'worker:send_message') {
        if (workerSendMessageError) {
          throw workerSendMessageError
        }
        if (payload.file && payload.file.name.includes('send_fail')) {
          throw new Error('HTTP 413 Payload Too Large')
        }
      }
      return { success: true }
    }
  }

  const mockPb = { send: async () => ({}) }

  const mockEventBus = {
    $bus: {
      emit: (event, payload) => {
        emittedEvents.push({
          event,
          payload
        })
        if (busListeners[event]) {
          busListeners[event](payload)
        }
      },
      on: (event, cb) => {
        busListeners[event] = cb
      },
      off: (event) => {
        delete busListeners[event]
      }
    }
  }

  const mockServices = {
    globalStore: { $state: globalState },
    storage: { $storage: mockStorage },
    eventBus: mockEventBus,
    cryptoWorker: { $worker: mockWorker },
    pocketbase: { pb: mockPb },
    utils: {
      $func: {
        debounce: (fn) => fn
      }
    },
    media: { $media: mockMedia },
    config: { $config: mockConfig }
  }

  before(async () => {
    // Override URL.createObjectURL and revokeObjectURL to be safe across happy-dom and Node
    globalThis.URL.createObjectURL = () => 'blob:http://localhost/mock-blob-url'
    globalThis.URL.revokeObjectURL = () => {
    }

    await loadComponent('atoll-popup')
    await loadComponent('atoll-chat-attachment-preview', { eventBus: mockEventBus })
    await loadComponent('atoll-chat-input-text', {
      eventBus: mockEventBus,
      globalStore: mockServices.globalStore
    })
    tagName = await loadComponent('atoll-chat-input', mockServices)
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    emittedEvents.length = 0
    savedMessages.length = 0
    deletedRecords.length = 0
    decryptionCache.clear()

    globalState.currentMessageText = ''
    globalState.activeSelectionId = 'room123'
    globalState.isOnline = true

    mediaBehavior = {}
    configMaxServerUpload = 26214400
    roomParticipantsCount = 2
    workerSendMessageError = null

    // Reset component state via event bus signal
    mockEventBus.$bus.emit('ui:cancel')
  })

  test('should show conversion error popup and reset UI when non-universal video conversion fails', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const failFile = new File(['raw_mkv'], 'fail_transcode.mkv', { type: 'video/x-matroska' })
    mockEventBus.$bus.emit('ui:file_selected', { file: failFile })

    await new Promise(resolve => setTimeout(resolve, 50))

    const popup = el.querySelector('[data-testid="mediaConversionErrorPopup"]')
    assert.ok(popup)
    assert.equal(popup.getAttribute('title'), 'Video Conversion Failed')
    assert.ok(popup.getAttribute('description').includes('could not be converted for web playback'))

    // Verify UI state reset
    const preview = el.querySelector('atoll-chat-attachment-preview')
    const previewWrapper = preview.closest('.d-block, .d-none')
    assert.ok(previewWrapper.classList.contains('d-none'))
  })

  test('should show conversion error popup in group chat when oversized video compression fails', async () => {
    roomParticipantsCount = 3
    globalState.activeSelectionId = 'group_room'
    configMaxServerUpload = 1000 // 1000 bytes max server upload limit

    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    // File content larger than 1000 bytes where compressVideo fails
    const oversizedContent = 'a'.repeat(1500)
    const failFile = new File([oversizedContent], 'fail_compress_oversized.mp4', { type: 'video/mp4' })

    mockEventBus.$bus.emit('ui:file_selected', { file: failFile })
    await new Promise(resolve => setTimeout(resolve, 50))

    const popup = el.querySelector('[data-testid="mediaConversionErrorPopup"]')
    assert.ok(popup)
    assert.equal(popup.getAttribute('title'), 'Video Conversion Failed')
    assert.ok(popup.getAttribute('description').includes('exceeds the 25MB server limit'))
  })

  test('should fall back to Ready to send (original format) for universal video <= 25MB when compression fails', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const file = new File(['small_mp4'], 'fail_compress_small.mp4', { type: 'video/mp4' })
    mediaBehavior.evaluateVideo = async () => ({
      shouldCompress: true,
      useWebRTC: false
    })

    mockEventBus.$bus.emit('ui:file_selected', { file })
    await new Promise(resolve => setTimeout(resolve, 50))

    const preview = el.querySelector('atoll-chat-attachment-preview')
    assert.equal(preview.getAttribute('upload-status'), 'Ready to send (original format)')
  })

  test('should show conversion error popup when non-universal image conversion fails', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const failFile = new File(['heic_raw'], 'fail_image.heic', { type: 'image/heic' })
    mockEventBus.$bus.emit('ui:file_selected', { file: failFile })
    await new Promise(resolve => setTimeout(resolve, 50))

    const popup = el.querySelector('[data-testid="mediaConversionErrorPopup"]')
    assert.ok(popup)
    assert.equal(popup.getAttribute('title'), 'Image Conversion Failed')
  })

  test('should show conversion error popup when non-universal audio conversion fails', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const failFile = new File(['wav_raw'], 'fail_audio.wav', { type: 'audio/wav' })
    mockEventBus.$bus.emit('ui:file_selected', { file: failFile })
    await new Promise(resolve => setTimeout(resolve, 50))

    const popup = el.querySelector('[data-testid="mediaConversionErrorPopup"]')
    assert.ok(popup)
    assert.equal(popup.getAttribute('title'), 'Audio Conversion Failed')
  })

  test('should discard stale conversion results if resetUI or a new file selection occurs', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    let resolveCompress
    mediaBehavior.compressVideo = () => new Promise(res => {
      resolveCompress = res
    })

    const slowFile = new File(['slow_video'], 'slow.mkv', { type: 'video/x-matroska' })
    mockEventBus.$bus.emit('ui:file_selected', { file: slowFile })

    // Immediately cancel/reset UI before conversion completes
    mockEventBus.$bus.emit('ui:cancel')

    // Resolve slow conversion
    if (resolveCompress) {
      resolveCompress(new File(['done'], 'slow.mp4', { type: 'video/mp4' }))
    }
    await new Promise(resolve => setTimeout(resolve, 30))

    // Verify state remained reset
    const preview = el.querySelector('atoll-chat-attachment-preview')
    const previewWrapper = preview.closest('.d-block, .d-none')
    assert.ok(previewWrapper.classList.contains('d-none'))
  })

  test('should block sendMessage with warning toast if file remains unconverted non-universal format', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    let isSendingPhase = false
    mediaBehavior.checkCompatibility = async (file) => {
      if (isSendingPhase) {
        return {
          requiresConversion: true,
          category: 'video'
        }
      }
      return {
        requiresConversion: false,
        category: 'none'
      }
    }

    const file = new File(['data'], 'valid.mp4', { type: 'video/mp4' })
    mockEventBus.$bus.emit('ui:file_selected', { file })
    await new Promise(resolve => setTimeout(resolve, 100))

    isSendingPhase = true
    mockEventBus.$bus.emit('ui:send_clicked')
    await new Promise(resolve => setTimeout(resolve, 100))

    const toastEvent = emittedEvents.find(e => e.event === 'ui:show_toast')
    assert.ok(toastEvent)
    assert.equal(toastEvent.payload.type, 'warning')
    assert.equal(toastEvent.payload.message, 'Cannot send unconverted media format')
  })

  test('should roll back optimistic storage records, eviction cache, and show danger toast on send failure', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 20))

    const failSendFile = new File(['large_data'], 'send_fail.mp4', { type: 'video/mp4' })
    mockEventBus.$bus.emit('ui:file_selected', { file: failSendFile })
    await new Promise(resolve => setTimeout(resolve, 100))

    mockEventBus.$bus.emit('ui:send_clicked')
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify optimistic record was saved
    assert.equal(savedMessages.length, 1)
    const localUuid = savedMessages[0].local_uuid

    // Verify rollback deletions were executed
    assert.ok(deletedRecords.some(r => r.collection === 'local_messages' && r.id === localUuid))
    assert.ok(deletedRecords.some(r => r.collection === 'local_files' && r.id === localUuid))

    // Verify decryption cache eviction
    assert.equal(decryptionCache.has(localUuid), false)

    // Verify db:new_local_data event was emitted to clear pending row from timeline
    assert.ok(emittedEvents.some(e => e.event === 'db:new_local_data' && e.payload.room_id === 'room123'))

    // Verify error toast
    const toastEvent = emittedEvents.find(e => e.event === 'ui:show_toast' && e.payload.type === 'danger')
    assert.ok(toastEvent)
    assert.ok(toastEvent.payload.message.includes('HTTP 413 Payload Too Large'))
  })
})
