import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Atoll Waveform Player Component', () => {
  let tagName

  beforeEach(async () => {
    document.body.innerHTML = ''
    if (!customElements.get('atoll-button')) {
      customElements.define('atoll-button', class extends HTMLElement {
        constructor () {
          super()
          this.innerHTML = '<button><slot></slot></button>'
        }
      })
    }
    tagName = await loadComponent('ui-waveform-player')
  })

  test('should initialize and display duration correctly', async () => {
    const el = document.createElement(tagName)
    el.setAttribute('duration', '125')
    el.setAttribute('waveform-src', 'data:image/svg+xml;utf8,<svg></svg>')
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 20))

    const timeDisplay = el.querySelector('.x-small.text-muted')
    assert.ok(timeDisplay, 'Time display element should exist')
    assert.equal(timeDisplay.textContent.trim(), '2:05', 'Should format 125 seconds as 2:05')
  })
})
