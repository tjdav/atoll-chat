import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import webrtcPlugin from '../../src/plugins/web-rtc-plugin.js'

describe('webrtcPlugin Unit Tests', () => {
  test('Phase 1 async context resolves without ReferenceErrors and initializes state machine', async () => {
    const plugin = webrtcPlugin()
    const busListeners = new Map()

    const mockBus = {
      on: (event, fn) => {
        if (!busListeners.has(event)) {
          busListeners.set(event, new Set())
        }
        busListeners.get(event).add(fn)
      },
      emit: (event, payload) => {
        const listeners = busListeners.get(event)
        if (listeners) {
          listeners.forEach(fn => fn(payload))
        }
      }
    }

    const pluginContext = {
      $bus: mockBus,
      config: plugin.client.config
    }

    const phase2Resolver = await plugin.client.context(pluginContext)
    assert.equal(typeof phase2Resolver, 'function')

    const mockState = {
      callStatus: 'idle',
      set: (key, val) => {
        mockState[key] = val
      }
    }

    const instanceContext = {
      cryptoWorker: {
        $worker: {
          execute: async () => {
          }
        }
      },
      globalStore: { $state: mockState },
      pocketbase: {
        pb: {
          send: async () => {
          }
        }
      }
    }

    const instance = phase2Resolver(instanceContext)
    assert.ok(instance.$webrtc)
    assert.equal(typeof instance.$webrtc.getFSM, 'function')

    const fsm = instance.$webrtc.getFSM()
    assert.equal(fsm.getState(), 'idle')
  })
})
