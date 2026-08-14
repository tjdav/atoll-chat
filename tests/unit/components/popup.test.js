import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Popup Component', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    tagName = await loadComponent('atoll-popup')
  })

  test('should render dialog with deterministic ARIA IDs and accessibility links', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('title', 'Access Dialog')
    el.setAttribute('description', 'Access Description')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const dialog = el.querySelector('dialog')
    assert.ok(dialog, 'Native dialog element should exist')

    const ariaLabelledBy = dialog.getAttribute('aria-labelledby')
    const ariaDescribedBy = dialog.getAttribute('aria-describedby')

    assert.ok(ariaLabelledBy, 'aria-labelledby should be non-empty')
    assert.ok(ariaDescribedBy, 'aria-describedby should be non-empty')

    const titleEl = el.querySelector('.atoll-popup-title')
    const descEl = el.querySelector('.atoll-popup-description')

    assert.ok(titleEl, 'Title element should exist')
    assert.ok(descEl, 'Description element should exist')

    assert.equal(titleEl.getAttribute('id'), ariaLabelledBy, 'Title ID should match aria-labelledby')
    assert.equal(descEl.getAttribute('id'), ariaDescribedBy, 'Description ID should match aria-describedby')
  })

  test('should support primaryDisabled and primaryLoading attributes on action buttons', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('title', 'Action States Test')
    el.setAttribute('primary-disabled', 'true')
    el.setAttribute('primary-loading', 'true')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const primaryBtn = el.querySelector('atoll-button[ref$="primaryBtn"]')
    assert.ok(primaryBtn, 'Primary button should be rendered in actions slot')

    assert.equal(primaryBtn.getAttribute('disabled'), 'true', 'primaryDisabled attribute should set disabled on primary button')
    assert.equal(primaryBtn.getAttribute('loading'), 'true', 'primaryLoading attribute should set loading on primary button')
  })

  test('should support heroIcon attribute and hero slot fallback', async () => {
    // heroIcon attribute
    const elWithIcon = document.createElement(tagName)
    elWithIcon.setAttribute('hero-icon', 'settings')
    document.body.appendChild(elWithIcon)

    await new Promise(resolve => setTimeout(resolve, 10))

    const heroWrapperIcon = elWithIcon.querySelector('.atoll-popup-hero')
    assert.ok(heroWrapperIcon, 'Hero wrapper should exist for hero-icon attribute')
    const icon = heroWrapperIcon.querySelector('atoll-icon')
    assert.ok(icon, 'Icon should exist inside hero wrapper')
    assert.equal(icon.getAttribute('name'), 'settings')

    // Slotted hero
    const elWithSlot = document.createElement(tagName)
    const slotChild = document.createElement('div')
    slotChild.setAttribute('slot', 'hero')
    slotChild.className = 'custom-hero-content'
    elWithSlot.appendChild(slotChild)
    document.body.appendChild(elWithSlot)

    await new Promise(resolve => setTimeout(resolve, 10))

    const heroWrapperSlot = elWithSlot.querySelector('.atoll-popup-hero')
    assert.ok(heroWrapperSlot, 'Hero wrapper should exist for slotted hero content')
    assert.ok(heroWrapperSlot.querySelector('.custom-hero-content'), 'Slotted hero content should be inside wrapper')
  })

  test('should open, dispatch open/close events with full detail payload, and toggle document.body class', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('title', 'Lifecycle Test')
    el.setAttribute('variant', 'danger')
    el.setAttribute('size', 'lg')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const events = []
    el.addEventListener('atoll-popup-open', (e) => events.push({
      type: 'open',
      detail: e.detail
    }))
    el.addEventListener('atoll-popup-close', (e) => events.push({
      type: 'close',
      detail: e.detail
    }))

    // Call show() host method
    el.show()
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(document.body.classList.contains('modal-open'), 'body should have modal-open class when open')
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], {
      type: 'open',
      detail: {
        variant: 'danger',
        size: 'lg',
        title: 'Lifecycle Test'
      }
    })

    // Call hide() host method
    el.hide()
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(document.body.classList.contains('modal-open'), false, 'body should remove modal-open class when closed')
    assert.equal(events.length, 2)
    assert.deepEqual(events[1], {
      type: 'close',
      detail: {
        variant: 'danger',
        size: 'lg',
        title: 'Lifecycle Test'
      }
    })
  })

  test('should handle event delegation for action buttons and dispatch primary, secondary, and tertiary events', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('title', 'Button Clicks Test')
    el.setAttribute('variant', 'confirm')
    el.setAttribute('primary-text', 'Confirm')
    el.setAttribute('tertiary-text', 'Later')
    el.setAttribute('secondary-text', 'Cancel')
    el.setAttribute('open', 'true')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const events = []
    el.addEventListener('atoll-popup-primary', (e) => events.push({
      type: 'primary',
      detail: e.detail
    }))
    el.addEventListener('atoll-popup-secondary', (e) => events.push({
      type: 'secondary',
      detail: e.detail
    }))
    el.addEventListener('atoll-popup-tertiary', (e) => events.push({
      type: 'tertiary',
      detail: e.detail
    }))
    el.addEventListener('atoll-popup-close', (e) => events.push({
      type: 'close',
      detail: e.detail
    }))

    const primaryBtn = el.querySelector('atoll-button[ref$="primaryBtn"]')
    const secondaryBtn = el.querySelector('atoll-button[ref$="secondaryBtn"]')
    const tertiaryBtn = el.querySelector('atoll-button[ref$="tertiaryBtn"]')
    const dialog = el.querySelector('dialog')

    assert.ok(primaryBtn, 'Primary button should exist')
    assert.ok(secondaryBtn, 'Secondary button should exist')
    assert.ok(tertiaryBtn, 'Tertiary button should exist')

    // Click primary button
    primaryBtn.click()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(events.filter(e => e.type === 'primary').length, 1)
    assert.deepEqual(events[0], {
      type: 'primary',
      detail: {
        variant: 'confirm',
        size: 'md',
        title: 'Button Clicks Test'
      }
    })

    // Click tertiary button
    tertiaryBtn.click()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(events.filter(e => e.type === 'tertiary').length, 1)
    assert.deepEqual(events[1], {
      type: 'tertiary',
      detail: {
        variant: 'confirm',
        size: 'md',
        title: 'Button Clicks Test'
      }
    })

    // Click secondary button (also closes modal)
    secondaryBtn.click()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(events.filter(e => e.type === 'secondary').length, 1)
    assert.deepEqual(events[2], {
      type: 'secondary',
      detail: {
        variant: 'confirm',
        size: 'md',
        title: 'Button Clicks Test'
      }
    })
    assert.equal(dialog.open, false, 'Clicking secondary button should close modal dialog')
    assert.equal(events.some(e => e.type === 'close'), true, 'Clicking secondary button should emit close event')
  })

  test('should trigger shake animation when staticBackdrop is clicked or Escape key cancel fires', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('title', 'Static Test')
    el.setAttribute('static-backdrop', 'true')
    el.setAttribute('open', 'true')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    const dialog = el.querySelector('dialog')
    const dialogBox = el.querySelector('.modal-dialog')

    // Simulate backdrop click
    dialog.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      target: dialog
    }))
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(dialogBox.classList.contains('atoll-popup-static-shake'), 'Dialog box should receive shake class on static backdrop click')

    // Simulate cancel event (Escape key)
    const cancelEvent = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancelEvent)
    assert.ok(cancelEvent.defaultPrevented, 'Cancel event should be default prevented for static backdrop')
  })

  test('should clean up document.body modal-open class when element is unmounted/disconnected', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('title', 'Unmount Test')
    el.setAttribute('open', 'true')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 10))

    assert.ok(document.body.classList.contains('modal-open'), 'body should have modal-open class while opened')

    // Remove component from DOM
    el.remove()
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(document.body.classList.contains('modal-open'), false, 'body modal-open class should be removed on unmount')
  })
})
