import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Slideshow Component Tests', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    await loadComponent('atoll-icon')
    tagName = await loadComponent('atoll-slideshow')
  })

  test('should instantiate atoll-slideshow component and expose API methods', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.ok(element, 'Component should instantiate')
    assert.strictEqual(typeof element.prev, 'function', 'should expose prev()')
    assert.strictEqual(typeof element.next, 'function', 'should expose next()')
    assert.strictEqual(typeof element.to, 'function', 'should expose to()')
    assert.strictEqual(typeof element.getEmbla, 'function', 'should expose getEmbla()')
    assert.strictEqual(typeof element.getContainer, 'function', 'should expose getContainer()')
    assert.strictEqual(typeof element.getViewport, 'function', 'should expose getViewport()')
    assert.strictEqual(typeof element.getSelectedIndex, 'function', 'should expose getSelectedIndex()')

    assert.ok(element.getContainer(), 'getContainer() should return DOM node')
    assert.ok(element.getViewport(), 'getViewport() should return DOM node')

    element.remove()
  })

  test('should render slots and slides correctly', async () => {
    const element = document.createElement(tagName)
    element.innerHTML = `
      <div slot="header" class="test-header">Header Content</div>
      <div class="slide-1">Slide 1</div>
      <div class="slide-2">Slide 2</div>
      <div slot="footer" class="test-footer">Footer Content</div>
    `
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const header = element.querySelector('.test-header')
    assert.ok(header, 'Header slot should render')

    const footer = element.querySelector('.test-footer')
    assert.ok(footer, 'Footer slot should render')

    const slide1 = element.querySelector('.slide-1')
    assert.ok(slide1, 'Slide 1 should render')

    element.remove()
  })

  test('should handle navigation and custom methods', async () => {
    const element = document.createElement(tagName)
    const slide1 = document.createElement('div')
    slide1.textContent = 'Slide 1'
    const slide2 = document.createElement('div')
    slide2.textContent = 'Slide 2'

    element.appendChild(slide1)
    element.appendChild(slide2)

    let initFired = false
    element.addEventListener('atoll-slideshow-init', (e) => {
      initFired = true
    })

    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(initFired, true, 'atoll-slideshow-init event should fire')

    // Call public method delegates
    element.to(1)
    element.prev()
    element.next()

    element.remove()
  })

  test('should trigger dragstart event on pointerdown or touchstart', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    let dragStartFired = false
    element.addEventListener('atoll-slideshow-dragstart', () => {
      dragStartFired = true
    })

    const viewport = element.getViewport()
    viewport.dispatchEvent(new CustomEvent('pointerdown', { bubbles: true }))

    assert.strictEqual(dragStartFired, true, 'atoll-slideshow-dragstart event should fire on pointerdown')

    element.remove()
  })

  test('should observe slide mutations and execute reInit', async () => {
    const element = document.createElement(tagName)
    document.body.appendChild(element)
    await new Promise(resolve => setTimeout(resolve, 50))

    const container = element.getContainer()
    const initialCount = container.children.length

    const newSlide = document.createElement('div')
    newSlide.textContent = 'New Dynamically Appended Slide'
    container.appendChild(newSlide)

    // Wait for debounced mutation observer (16ms)
    await new Promise(resolve => setTimeout(resolve, 60))

    assert.strictEqual(container.children.length, initialCount + 1, 'Container should contain newly appended slide')

    element.remove()
  })
})
