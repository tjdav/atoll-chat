import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Toast Component', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''

    // Ensure showPopover and hidePopover exist on HTMLElement prototype in test environment
    if (!HTMLElement.prototype.showPopover) {
      HTMLElement.prototype.showPopover = function () {
        this.setAttribute('popover-open', 'true')
      }
    }
    if (!HTMLElement.prototype.hidePopover) {
      HTMLElement.prototype.hidePopover = function () {
        this.removeAttribute('popover-open')
      }
    }

    // Pre-load icon dependency
    await loadComponent('atoll-icon')
    tagName = await loadComponent('atoll-toast')
  })

  test('should render popover container with popover="manual"', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    const container = el.querySelector('[popover="manual"]')
    assert.ok(container, 'Popover container element should exist with popover="manual"')
    assert.ok(container.classList.contains('atoll-toast-container'), 'Popover container should have atoll-toast-container class')
    assert.ok(container.classList.contains('placement-bottom-start'), 'Popover container should have default placement class')
  })

  test('should show toast programmatically and call showPopover()', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    let showPopoverCalled = false
    const container = el.querySelector('[popover="manual"]')
    container.showPopover = () => {
      showPopoverCalled = true
    }

    const toastId = el.show({
      message: 'Operation completed',
      variant: 'success',
      duration: 0
    })

    await new Promise(resolve => setTimeout(resolve, 30))

    assert.ok(showPopoverCalled, 'showPopover() should be called when showing first toast')
    assert.ok(toastId, 'show() should return a valid toast ID')

    const card = el.querySelector(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    assert.ok(card, 'Toast card element should exist in DOM')
    assert.equal(card.getAttribute('role'), 'status', 'Success toast should have role="status"')
    assert.equal(card.getAttribute('aria-live'), 'polite', 'Success toast should have aria-live="polite"')

    const msg = card.querySelector('.atoll-toast-message')
    assert.equal(msg.textContent, 'Operation completed')
  })

  test('should accept variant and type properties interchangeably and map icons/ARIA roles', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    // Danger variant via 'type' property
    const id1 = el.show({
      message: 'Danger Alert',
      type: 'danger',
      duration: 0
    })

    await new Promise(resolve => setTimeout(resolve, 30))

    const dangerCard = el.querySelector(`.atoll-toast-card[data-toast-id="${id1}"]`)
    assert.ok(dangerCard.classList.contains('atoll-toast-card-danger'), 'Card should receive danger variant class')
    assert.equal(dangerCard.getAttribute('role'), 'alert', 'Danger toast should have role="alert"')
    assert.equal(dangerCard.getAttribute('aria-live'), 'assertive', 'Danger toast should have aria-live="assertive"')

    // Warning variant via 'variant' property
    const id2 = el.show({
      message: 'Warning Notice',
      variant: 'warning',
      duration: 0
    })

    await new Promise(resolve => setTimeout(resolve, 30))

    const warningCard = el.querySelector(`.atoll-toast-card[data-toast-id="${id2}"]`)
    assert.ok(warningCard.classList.contains('atoll-toast-card-warning'), 'Card should receive warning variant class')
    assert.equal(warningCard.getAttribute('role'), 'alert', 'Warning toast should have role="alert"')
  })

  test('should enforce maxToasts capacity limit and evict oldest toast on overflow', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('max-toasts', '3')
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    const id1 = el.show({ message: 'Toast 1', duration: 0 })
    const id2 = el.show({ message: 'Toast 2', duration: 0 })
    const id3 = el.show({ message: 'Toast 3', duration: 0 })

    await new Promise(resolve => setTimeout(resolve, 30))

    let cards = el.querySelectorAll('.atoll-toast-card:not(.atoll-toast-closing)')
    assert.equal(cards.length, 3, 'Stack should hold 3 toasts')

    // Add 4th toast to exceed capacity
    const id4 = el.show({ message: 'Toast 4', duration: 0 })

    await new Promise(resolve => setTimeout(resolve, 200))

    cards = el.querySelectorAll('.atoll-toast-card:not(.atoll-toast-closing)')
    assert.equal(cards.length, 3, 'Stack should remain capped at 3 toasts')

    const card1 = el.querySelector(`.atoll-toast-card[data-toast-id="${id1}"]`)
    assert.equal(card1, null, 'Oldest toast (Toast 1) should be evicted')

    const card4 = el.querySelector(`.atoll-toast-card[data-toast-id="${id4}"]`)
    assert.ok(card4, 'Newest toast (Toast 4) should be present in stack')
  })

  test('should pause timer on mouseenter/focusin and resume on mouseleave/focusout', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    const toastId = el.show({
      message: 'Hover test toast',
      duration: 500
    })

    await new Promise(resolve => setTimeout(resolve, 30))

    const card = el.querySelector(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    assert.ok(card, 'Toast card should exist')

    // Simulate mouseenter
    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    assert.ok(card.classList.contains('atoll-toast-paused'), 'Card should receive atoll-toast-paused class on mouseenter')

    // Wait 600ms (longer than original 500ms duration) while paused
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.ok(document.body.contains(card), 'Toast card should NOT auto-dismiss while paused')

    // Simulate mouseleave
    card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    assert.equal(card.classList.contains('atoll-toast-paused'), false, 'atoll-toast-paused class should be removed on mouseleave')

    // Wait remaining time for auto-dismiss
    await new Promise(resolve => setTimeout(resolve, 650))
    const dismissedCard = el.querySelector(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    assert.equal(dismissedCard, null, 'Toast card should auto-dismiss after resuming')
  })

  test('should support interactive action button and trigger callback', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    let actionClicked = false
    const toastId = el.show({
      message: 'Item deleted',
      variant: 'info',
      duration: 0,
      action: {
        label: 'Undo',
        onClick: (toast) => {
          actionClicked = true
          assert.equal(toast.message, 'Item deleted')
        }
      }
    })

    await new Promise(resolve => setTimeout(resolve, 30))

    const card = el.querySelector(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    const actionBtn = card.querySelector('.atoll-toast-action-btn')
    assert.ok(actionBtn, 'Action button should exist in card')
    assert.equal(actionBtn.textContent, 'Undo')

    actionBtn.click()
    await new Promise(resolve => setTimeout(resolve, 200))

    assert.ok(actionClicked, 'Action button onClick callback should be executed')
    const dismissedCard = el.querySelector(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    assert.equal(dismissedCard, null, 'Toast card should be dismissed after action click')
  })

  test('should dismiss toast when close button is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    const toastId = el.show({
      message: 'Dismiss me',
      duration: 0
    })

    await new Promise(resolve => setTimeout(resolve, 30))

    const card = el.querySelector(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    const closeBtn = card.querySelector('.atoll-toast-close-btn')
    assert.ok(closeBtn, 'Close button should exist')

    closeBtn.click()
    await new Promise(resolve => setTimeout(resolve, 200))

    const dismissedCard = el.querySelector(`.atoll-toast-card[data-toast-id="${toastId}"]`)
    assert.equal(dismissedCard, null, 'Toast card should be removed after close button click')
  })

  test('should dismiss newest toast on Escape key press inside popover container', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    const id1 = el.show({ message: 'First', duration: 0 })
    const id2 = el.show({ message: 'Second', duration: 0 })

    await new Promise(resolve => setTimeout(resolve, 30))

    const container = el.querySelector('[popover="manual"]')
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    await new Promise(resolve => setTimeout(resolve, 200))

    const card2 = el.querySelector(`.atoll-toast-card[data-toast-id="${id2}"]`)
    assert.equal(card2, null, 'Newest toast (Second) should be dismissed on Escape key')

    const card1 = el.querySelector(`.atoll-toast-card[data-toast-id="${id1}"]`)
    assert.ok(card1, 'First toast should remain in stack')
  })

  test('should clear all active toasts when clear() is called', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise(resolve => setTimeout(resolve, 10))

    el.show({ message: 'Toast A', duration: 0 })
    el.show({ message: 'Toast B', duration: 0 })

    await new Promise(resolve => setTimeout(resolve, 30))

    let cards = el.querySelectorAll('.atoll-toast-card')
    assert.equal(cards.length, 2)

    el.clear()
    await new Promise(resolve => setTimeout(resolve, 30))

    cards = el.querySelectorAll('.atoll-toast-card')
    assert.equal(cards.length, 0, 'All toast cards should be removed immediately on clear()')
  })
})
