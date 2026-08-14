import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Profile Component', () => {
  let tagName

  // Persistent mutable singleton mocks bound to component definition closure
  const mockState = {
    isAuthenticated: true,
    currentUser: null,
    users: {},
    listeners: {},
    subscribe (key, cb) {
      if (!this.listeners[key]) {
        this.listeners[key] = new Set()
      }
      this.listeners[key].add(cb)
      return () => {
        this.listeners[key]?.delete(cb)
      }
    },
    emit (key, payload) {
      this.listeners[key]?.forEach(cb => cb(payload))
    }
  }

  const mockPb = {
    baseUrl: '/',
    collection: null
  }

  const mockStorage = {
    getAllRoomsSorted: async () => []
  }

  beforeEach(async () => {
    document.body.innerHTML = ''

    // Reset mutable singleton states before each test
    mockState.isAuthenticated = true
    mockState.currentUser = null
    mockState.users = {}
    mockState.listeners = {}

    mockPb.baseUrl = '/'
    mockPb.collection = null

    mockStorage.getAllRoomsSorted = async () => []

    tagName = await loadComponent('atoll-profile', {
      globalStore: { $state: mockState },
      pocketbase: { pb: mockPb },
      storage: { $storage: mockStorage }
    })
  })

  test('should apply correct size and ring classes', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('size', 'lg')
    el.setAttribute('ring', 'true')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const wrapper = el.querySelector('.atoll-profile')
    assert.ok(wrapper, 'Profile wrapper element should exist')
    assert.ok(wrapper.classList.contains('atoll-profile-lg'), 'Should contain atoll-profile-lg class')
    assert.ok(wrapper.classList.contains('atoll-profile-ring'), 'Should contain atoll-profile-ring class')
  })

  test('should compute initials and deterministic background style for user names', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('name', 'John Doe')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const initialsSpan = el.querySelector('.atoll-profile-initials')
    assert.ok(initialsSpan, 'Initials span should exist')
    assert.equal(initialsSpan.textContent.trim(), 'JD')

    const fallbackSpan = el.querySelector('.atoll-profile-fallback')
    assert.ok(fallbackSpan, 'Fallback span should exist')
    const styleAttr = fallbackSpan.getAttribute('style') || ''
    assert.ok(styleAttr.includes('background-color:'), 'Style should contain background-color')
  })

  test('should render overlay icon using atoll-icon tag', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('icon-name', 'check')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const overlayIconSlot = el.querySelector('.atoll-profile-icon')
    assert.ok(overlayIconSlot, 'Overlay icon slot container should exist')

    const iconEl = overlayIconSlot.querySelector('atoll-icon')
    assert.ok(iconEl, 'Overlay icon should render an atoll-icon element')
    assert.equal(iconEl.getAttribute('name'), 'check')

    const badgeEl = overlayIconSlot.querySelector('atoll-badge')
    assert.equal(badgeEl, null, 'Overlay icon slot should NOT render an atoll-badge element')
  })

  test('should render badge using atoll-badge tag', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('badge', '3')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const badgeSlot = el.querySelector('.atoll-profile-badge')
    assert.ok(badgeSlot, 'Badge slot container should exist')

    const badgeEl = badgeSlot.querySelector('atoll-badge')
    assert.ok(badgeEl, 'Badge slot should render an atoll-badge element')
    assert.equal(badgeEl.getAttribute('count'), '3')
  })

  test('should synchronize user profile data from globalStore when userId is provided', async () => {
    mockState.users.user123 = {
      id: 'user123',
      name: 'Alice Smith',
      avatar: ''
    }

    const el = document.createElement(tagName)
    el.setAttribute('user-id', 'user123')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const initialsSpan = el.querySelector('.atoll-profile-initials')
    assert.ok(initialsSpan, 'Initials span should exist')
    assert.equal(initialsSpan.textContent.trim(), 'AS')

    // Simulate real-time update in global store
    mockState.users.user123 = {
      id: 'user123',
      name: 'Bob Marley',
      avatar: ''
    }
    mockState.emit('users', mockState.users)

    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(initialsSpan.textContent.trim(), 'BM')
  })

  test('should safely handle missing pb.collection without throwing error', async () => {
    // Setting pb.collection to null (not a function)
    mockPb.collection = null

    const el = document.createElement(tagName)
    // Non-cached user ID triggers fetchAndCacheUser
    el.setAttribute('user-id', 'unknown_user_999')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    // Component should remain intact with default icon/fallback without crashing
    const wrapper = el.querySelector('.atoll-profile')
    assert.ok(wrapper, 'Profile element should render cleanly despite missing pb.collection')
  })

  test('should apply multiparty grid classes and splitCount constraints', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('type', 'multiparty')
    el.setAttribute('split-count', '3')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const circle = el.querySelector('.atoll-profile-circle')
    assert.ok(circle, 'Profile circle container should exist')
    assert.ok(circle.classList.contains('multiparty-3'), 'Should apply multiparty-3 grid class')
  })

  test('should render initials and colored fallbacks for images without src in multiparty mode', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('type', 'multiparty')
    el.setAttribute('split-count', '2')

    const slotDiv = document.createElement('div')
    slotDiv.setAttribute('slot', 'image')

    const img1 = document.createElement('img')
    img1.setAttribute('alt', 'Alice Smith')
    slotDiv.appendChild(img1)

    const img2 = document.createElement('img')
    img2.setAttribute('alt', 'Bob Jones')
    slotDiv.appendChild(img2)

    el.appendChild(slotDiv)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const imageContainer = el.querySelector('[slot="image"]')
    assert.ok(imageContainer, 'Slot image container should exist')

    const fallbacks = imageContainer.querySelectorAll('.atoll-profile-fallback')
    assert.equal(fallbacks.length, 2, 'Should render 2 fallbacks for missing images')

    const initialsSpans = imageContainer.querySelectorAll('.atoll-profile-initials')
    assert.equal(initialsSpans.length, 2, 'Should render 2 initials spans')
    assert.equal(initialsSpans[0].textContent.trim(), 'AS')
    assert.equal(initialsSpans[1].textContent.trim(), 'BJ')
  })

  test('should automatically create fallback cells when fewer items are provided than splitCount', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('type', 'multiparty')
    el.setAttribute('split-count', '3')

    const slotDiv = document.createElement('div')
    slotDiv.setAttribute('slot', 'image')

    const img1 = document.createElement('img')
    img1.setAttribute('alt', 'Charlie Brown')
    slotDiv.appendChild(img1)

    el.appendChild(slotDiv)
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const imageContainer = el.querySelector('[slot="image"]')
    assert.ok(imageContainer, 'Slot image container should exist')

    const fallbacks = imageContainer.querySelectorAll('.atoll-profile-fallback')
    assert.equal(fallbacks.length, 3, 'Should render 3 total fallbacks (1 for provided img, 2 auto-generated)')

    const defaultFallbacks = imageContainer.querySelectorAll('.atoll-profile-fallback[data-default-fallback="true"]')
    assert.equal(defaultFallbacks.length, 2, 'Should generate 2 default fallback icon cells')
  })
})
