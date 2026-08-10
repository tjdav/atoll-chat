import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Settings Pane Component', () => {
  let tagName
  let emittedEvents

  beforeEach(async () => {
    document.body.innerHTML = ''
    emittedEvents = []

    const mockEventBus = {
      $bus: {
        emit: (event, payload) => {
          emittedEvents.push({
            event,
            payload
          })
        },
        on: (event, callback) => {
          // Keep callback listener for test purposes
        },
        off: () => {
        }
      }
    }

    const mockGlobalStore = {
      $state: {
        activeSelectionType: null,
        activeSelectionId: null,
        subscribe: () => () => {
        }
      }
    }

    const mockPocketBase = {
      authStore: {
        record: { id: 'alice_id' }
      },
      collection: (name) => {
        return {
          getFullList: async (opts) => {
            if (name === 'user_trust') {
              return [{
                id: 'trust_1',
                user: 'alice_id',
                tier: 'owner'
              }]
            }
            return []
          }
        }
      }
    }

    tagName = await loadComponent('settings-pane', {
      eventBus: mockEventBus,
      globalStore: mockGlobalStore,
      pocketbase: mockPocketBase
    })
  })

  test('should render navbar list items and Administration group if user has owner tier', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    // Wait for hydration
    await new Promise(resolve => setTimeout(resolve, 50))

    // Ensure it was rendered and custom elements loaded
    const navbar = el.querySelector('#settings-navbar')
    assert.ok(navbar, 'Settings navbar should be rendered')

    const adminNavbar = el.querySelector('#admin-settings-navbar')
    assert.ok(adminNavbar, 'Admin settings navbar should exist')

    // Since adminGroup is parent of admin-settings-navbar, verify it's visible (no d-none class)
    const adminGroup = adminNavbar.parentElement
    assert.ok(adminGroup, 'Admin group parent should exist')
    assert.equal(adminGroup.classList.contains('d-none'), false, 'Admin group should NOT have d-none class for owners')
  })

  test('should emit scrolling and selection events when item is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 50))

    const firstItem = el.querySelector('#settings-navbar atoll-list-item')
    assert.ok(firstItem, 'First navbar item should exist')

    // Simulate clicking the first item by dispatching 'atoll-item-click'
    firstItem.dispatchEvent(new CustomEvent('atoll-item-click', { bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 20))

    // Check emitted events
    const selectionMade = emittedEvents.find(e => e.event === 'ui:selection_made')
    const scrollTriggered = emittedEvents.find(e => e.event === 'settings:scroll_to_section')

    assert.ok(selectionMade, 'ui:selection_made event should be emitted')
    assert.ok(scrollTriggered, 'settings:scroll_to_section event should be emitted')
    assert.equal(scrollTriggered.payload.targetId, '#section-account')
  })
})
