import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Transcription Settings Component', () => {
  let tagName

  // Define shared objects once at the suite level so the registered custom element class
  // always points to these exact references.
  const sharedState = {
    transcriptionModel: 'onnx-community/moonshine-tiny-ONNX',
    subscribeCallbacks: [],
    subscribe (key, cb) {
      if (key === 'transcriptionModel') {
        this.subscribeCallbacks.push(cb)
      }
      return () => {
        this.subscribeCallbacks = this.subscribeCallbacks.filter(c => c !== cb)
      }
    },
    triggerSubscribe (val) {
      this.transcriptionModel = val
      this.subscribeCallbacks.forEach(cb => cb(val))
    }
  }

  let savedConfigKey = null
  let savedConfigValue = null

  const sharedGlobalStore = {
    $state: sharedState
  }

  const sharedStorage = {
    $storage: {
      saveConfig: async (key, val) => {
        savedConfigKey = key
        savedConfigValue = val
      },
      getConfig: async (key) => {
        return sharedState.transcriptionModel
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    // Reset the state and variables before each test
    sharedState.transcriptionModel = 'onnx-community/moonshine-tiny-ONNX'
    sharedState.subscribeCallbacks = []
    savedConfigKey = null
    savedConfigValue = null

    // Register nested web components that are used by transcription-settings
    await loadComponent('atoll-checkbox')
    await loadComponent('atoll-list-item')
    await loadComponent('atoll-list')

    tagName = await loadComponent('transcription-settings', {
      globalStore: sharedGlobalStore,
      storage: sharedStorage
    })
  })

  test('should render transcription settings options correctly', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    // Wait for hydration and rendering
    await new Promise((resolve) => setTimeout(resolve, 50))

    const list = el.querySelector('atoll-list')
    assert.ok(list, 'atoll-list should be rendered')

    const optTiny = el.querySelector('[data-testid="opt-moonshine-tiny"]')
    const optBase = el.querySelector('[data-testid="opt-moonshine-base"]')
    const optMedium = el.querySelector('[data-testid="opt-whisper-medium"]')

    assert.ok(optTiny, 'Moonshine Tiny option should be rendered')
    assert.ok(optBase, 'Moonshine Base option should be rendered')
    assert.ok(optMedium, 'Whisper Medium option should be rendered')

    assert.equal(optTiny.getAttribute('checked'), 'true', 'Tiny option should be checked by default')
    assert.equal(optTiny.getAttribute('selected'), 'true', 'Tiny option should be selected by default')
    assert.equal(optTiny.getAttribute('highlighted'), 'true', 'Tiny option should be highlighted by default')

    assert.equal(optBase.getAttribute('checked'), null, 'Base option should not be checked by default')
    assert.equal(optMedium.getAttribute('checked'), null, 'Medium option should not be checked by default')
  })

  test('should handle changing selected transcription model option to Small', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const optTiny = el.querySelector('[data-testid="opt-moonshine-tiny"]')
    const optBase = el.querySelector('[data-testid="opt-moonshine-base"]')
    assert.ok(optBase)

    // Simulate selecting the Small/Base option using custom selection change event
    optBase.dispatchEvent(new CustomEvent('atoll-selection-change', {
      bubbles: true,
      composed: true,
      detail: [{
        checked: true,
        value: 'onnx-community/moonshine-base-ONNX'
      }]
    }))

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(sharedState.transcriptionModel, 'onnx-community/moonshine-base-ONNX', 'State transcription model should update to moonshine-base-ONNX')
    assert.equal(savedConfigKey, 'transcription_model', 'Config should persist to transcription_model key')
    assert.equal(savedConfigValue, 'onnx-community/moonshine-base-ONNX', 'Config value should update to moonshine-base-ONNX')

    assert.equal(optBase.getAttribute('checked'), 'true', 'Base option should be checked')
    assert.equal(optBase.getAttribute('selected'), 'true', 'Base option should be selected')
    assert.equal(optTiny.getAttribute('checked'), null, 'Tiny option should be cleared')
  })

  test('should handle changing selected transcription model option to Medium', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const optTiny = el.querySelector('[data-testid="opt-moonshine-tiny"]')
    const optMedium = el.querySelector('[data-testid="opt-whisper-medium"]')
    assert.ok(optMedium)

    // Simulate selecting the Medium option using custom selection change event
    optMedium.dispatchEvent(new CustomEvent('atoll-selection-change', {
      bubbles: true,
      composed: true,
      detail: [{
        checked: true,
        value: 'onnx-community/whisper-medium'
      }]
    }))

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(sharedState.transcriptionModel, 'onnx-community/whisper-medium', 'State transcription model should update to whisper-medium')
    assert.equal(savedConfigKey, 'transcription_model', 'Config should persist to transcription_model key')
    assert.equal(savedConfigValue, 'onnx-community/whisper-medium', 'Config value should update to whisper-medium')

    assert.equal(optMedium.getAttribute('checked'), 'true', 'Medium option should be checked')
    assert.equal(optMedium.getAttribute('selected'), 'true', 'Medium option should be selected')
    assert.equal(optTiny.getAttribute('checked'), null, 'Tiny option should be cleared')
  })

  test('should support cross-tab synchronization of transcription model via global store subscription', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const optTiny = el.querySelector('[data-testid="opt-moonshine-tiny"]')
    const optMedium = el.querySelector('[data-testid="opt-whisper-medium"]')

    assert.equal(optTiny.getAttribute('checked'), 'true')
    assert.equal(optMedium.getAttribute('checked'), null)

    // Trigger external subscription event
    sharedState.triggerSubscribe('onnx-community/whisper-medium')

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(optTiny.getAttribute('checked'), null, 'Tiny should be cleared after remote change')
    assert.equal(optMedium.getAttribute('checked'), 'true', 'Medium should be checked after remote change')
    assert.equal(optMedium.getAttribute('selected'), 'true', 'Medium should be selected after remote change')
    assert.equal(optMedium.getAttribute('highlighted'), 'true', 'Medium should be highlighted after remote change')
  })
})
