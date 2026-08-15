import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Admin Security XSS Error Handling', () => {
  describe('admin-trust-matrix component', () => {
    test('renders malicious error message safely as plain text without innerHTML execution', async () => {
      document.body.innerHTML = ''

      const xssPayload = '<img src=x onerror=alert(1)><script>alert("xss")</script>'
      const mockPocketbase = {
        collection: () => ({
          getFullList: async () => {
            throw new Error(`Failed with XSS: ${xssPayload}`)
          }
        })
      }

      const tagName = await loadComponent('admin-trust-matrix', {
        pocketbase: mockPocketbase
      })

      const el = document.createElement(tagName)
      document.body.appendChild(el)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const usersTableBody = el.querySelector('[data-testid="usersTableBody"]')
      assert.ok(usersTableBody, 'usersTableBody should exist')

      // Ensure no script or img elements were injected into the DOM
      const scriptEl = usersTableBody.querySelector('script')
      const imgEl = usersTableBody.querySelector('img')
      assert.equal(scriptEl, null, 'script element must not be injected into DOM')
      assert.equal(imgEl, null, 'img element must not be injected into DOM')

      // Ensure the error text is rendered strictly as plain text
      const td = usersTableBody.querySelector('td')
      assert.ok(td, 'td cell should exist')
      assert.ok(
        td.textContent.includes(xssPayload),
        'XSS payload string should be rendered safely as textContent'
      )
    })
  })

  describe('admin-requests component', () => {
    test('renders malicious error message safely as plain text without innerHTML execution', async () => {
      document.body.innerHTML = ''

      const xssPayload = '<svg/onload=alert(1)><b onmouseover=alert(2)>error</b>'
      const mockPocketbase = {
        collection: () => {
          throw new Error(`Failed with XSS: ${xssPayload}`)
        }
      }

      const mockGlobalStore = {
        $state: {
          currentUserKeys: { private_box_key: 'test_key' },
          cryptoWorker: { request: async () => '' }
        }
      }

      const tagName = await loadComponent('admin-requests', {
        pocketbase: mockPocketbase,
        globalStore: mockGlobalStore
      })

      const el = document.createElement(tagName)
      document.body.appendChild(el)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const requestsList = el.querySelector('[data-testid="requestsList"]')
      assert.ok(requestsList, 'requestsList should exist')

      // Ensure no svg or b tags were injected into the DOM
      const svgEl = requestsList.querySelector('svg')
      const bEl = requestsList.querySelector('b')
      assert.equal(svgEl, null, 'svg element must not be injected into DOM')
      assert.equal(bEl, null, 'b element must not be injected into DOM')

      // Ensure error message is safely in textContent
      const errDiv = requestsList.querySelector('.text-danger')
      assert.ok(errDiv, 'error div should exist')
      assert.ok(
        errDiv.textContent.includes(xssPayload),
        'XSS payload string should be rendered safely as textContent'
      )
    })
  })
})
