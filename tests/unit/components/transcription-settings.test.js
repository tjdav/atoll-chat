import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Transcription Settings Component', () => {
  let tagName

  // Define shared objects once at the suite level so the registered custom element class
  // always points to these exact references.
  const sharedState = {
    transcriptionModel: 'onnx-community/moonshine-tiny-ONNX',
    subscribe: (key, cb) => {
      return () => {}
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
    savedConfigKey = null
    savedConfigValue = null

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

    const optTiny = el.querySelector('[data-testid="opt-moonshine-tiny"]')
    const optBase = el.querySelector('[data-testid="opt-moonshine-base"]')

    assert.ok(optTiny, 'Moonshine Tiny option should be rendered')
    assert.ok(optBase, 'Moonshine Base option should be rendered')

    const inputTiny = optTiny.querySelector('input')
    const inputBase = optBase.querySelector('input')

    assert.equal(inputTiny.checked, true, 'Tiny option should be checked by default')
    assert.equal(inputBase.checked, false, 'Base option should not be checked by default')
  })

  test('should handle changing selected transcription model option', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const optBase = el.querySelector('[data-testid="opt-moonshine-base"]')
    assert.ok(optBase)

    // Trigger click on base option
    optBase.click()

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(sharedState.transcriptionModel, 'onnx-community/moonshine-base-ONNX', 'State transcription model should update to moonshine-base-ONNX')
    assert.equal(savedConfigKey, 'transcription_model', 'Config should persist to transcription_model key')
    assert.equal(savedConfigValue, 'onnx-community/moonshine-base-ONNX', 'Config value should update to moonshine-base-ONNX')
  })
})
