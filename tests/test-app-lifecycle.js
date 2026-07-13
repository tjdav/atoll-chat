import { createWebAppLifecycleAdapter } from '../src/plugins/app-lifecycle-adapter-web.js'

async function runTest () {
  console.log('--- App Lifecycle Test ---')

  // Mock global document and visibilityState
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener (event, callback) {
      this._listener = callback
    },
    _triggerVisibilityChange (state) {
      this.visibilityState = state
      if (this._listener) {
        this._listener()
      }
    }
  }

  // Mock Event Bus
  const mockBus = {
    _emitted: [],
    emit (event, payload) {
      this._emitted.push({
        event,
        payload
      })
    }
  }

  const adapter = createWebAppLifecycleAdapter()
  adapter.registerListeners(mockBus)

  // Trigger when visible
  globalThis.document._triggerVisibilityChange('visible')

  if (mockBus._emitted.length === 1 && mockBus._emitted[0].event === 'app:foreground') {
    console.log('SUCCESS: Web visibility change listener correctly emits app:foreground on transition to visible.')
  } else {
    console.error('FAILURE: Expected app:foreground to be emitted. Emitted:', mockBus._emitted)
    process.exit(1)
  }

  // Trigger when hidden
  mockBus._emitted = []
  globalThis.document._triggerVisibilityChange('hidden')

  if (mockBus._emitted.length === 0) {
    console.log('SUCCESS: Web visibility change listener does not emit app:foreground on transition to hidden.')
  } else {
    console.error('FAILURE: Unexpected event emitted on hidden transition:', mockBus._emitted)
    process.exit(1)
  }
}

runTest()
