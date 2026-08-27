import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Settings Invitations Component', () => {
  let tagName
  let mockList = []
  let mockSendHandler

  beforeEach(async () => {
    document.body.innerHTML = ''
    mockList = []

    await loadComponent('atoll-icon')
    await loadComponent('atoll-badge')
    await loadComponent('atoll-list-item')

    mockSendHandler = async (path, opts = {}) => {
      if (path === '/api/custom/admin/overview') {
        return {
          metadata: {
            invite_mode: 'delegated',
            default_trusted_quota: 5,
            max_uses_per_invite: 3,
            allow_quota_requests: true
          }
        }
      }
      if (path === '/api/custom/invites/list') {
        return mockList
      }
      if (path === '/api/custom/invites/generate') {
        const newInv = {
          id: 'inv_new123',
          code: 'INV-TEST-9999',
          is_used: false,
          max_uses: 3,
          used_count: 0,
          expires_at: null,
          used_by: null,
          created: new Date().toISOString()
        }
        return newInv
      }
      return {}
    }

    const mockGlobalStore = {
      $state: {
        subscribe: () => () => {
        },
        cryptoWorker: { request: async () => 'sealed_reason' }
      },
      $bus: {
        emit: () => {
        }
      }
    }

    const mockPocketbase = {
      authStore: {
        record: {
          id: 'user_123',
          username: 'alice'
        }
      },
      send: (path, opts) => mockSendHandler(path, opts),
      collection: () => ({
        getFullList: async () => [
          {
            user: 'user_123',
            invite_quota: 3,
            tier: 'standard',
            invites_revoked: false
          }
        ]
      })
    }

    tagName = await loadComponent('settings-invitations', {
      globalStore: mockGlobalStore,
      pocketbase: mockPocketbase,
      bootstrap: Promise.resolve({
        Dropdown: class {
          constructor () {
          }
          show () {
          }
          hide () {
          }
        }
      })
    })
  })

  test('should render empty state when 0 invitations exist', async () => {
    mockList = []
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const emptyCard = el.querySelector('[data-testid="emptyStateCard"]')
    const historyCard = el.querySelector('[data-testid="historyCard"]')

    assert.ok(emptyCard, 'Empty state card should exist')
    assert.ok(!emptyCard.classList.contains('d-none'), 'Empty state card should be visible')
    assert.ok(historyCard.classList.contains('d-none'), 'History card should be hidden')
  })

  test('should render list with metadata when invitations exist', async () => {
    mockList = [
      {
        id: 'inv_1',
        code: 'INV-1111-2222',
        is_used: false,
        max_uses: 3,
        used_count: 1,
        created: new Date().toISOString(),
        used_by: { username: 'bob' }
      }
    ]
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const emptyCard = el.querySelector('[data-testid="emptyStateCard"]')
    const historyCard = el.querySelector('[data-testid="historyCard"]')
    const invitationsList = el.querySelector('[data-testid="invitationsList"]')

    assert.ok(emptyCard.classList.contains('d-none'), 'Empty state card should be hidden')
    assert.ok(!historyCard.classList.contains('d-none'), 'History card should be visible')

    const item = invitationsList.querySelector('atoll-list-item')
    assert.ok(item, 'An atoll-list-item should be rendered')
    assert.ok(item.outerHTML.includes('INV-1111-2222'), 'List item should contain invite code')
    assert.equal(item.getAttribute('description'), '1 / 3 uses • Claimed by @bob', 'Description should contain usages and claimed user handle')
    assert.ok(item.outerHTML.includes('Active'), 'List item should contain status badge')
  })

  test('should generate invitation and insert atoll-list-item at top of list', async () => {
    mockList = []
    const el = document.createElement(tagName)
    document.body.appendChild(el)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnGenerate = el.querySelector('[data-testid="btnGenerateInvite"]')
    btnGenerate.click()

    await new Promise((resolve) => setTimeout(resolve, 50))

    const invitationsList = el.querySelector('[data-testid="invitationsList"]')
    const emptyCard = el.querySelector('[data-testid="emptyStateCard"]')

    assert.ok(emptyCard.classList.contains('d-none'), 'Empty state should hide after generation')
    const firstItem = invitationsList.querySelector('atoll-list-item')
    assert.ok(firstItem, 'First item should be an atoll-list-item')
    assert.ok(firstItem.innerHTML.includes('INV-TEST-9999'), 'List should contain newly generated code')
  })
})
