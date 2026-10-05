import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Mirror copy of surface-host's DOM element tag reconciliation algorithm.
 *
 * @param {object} panel - DOM panel shim.
 * @param {string | null} currentTag - Tag currently mounted in panel.
 * @param {string | null} nextTag - Tag to mount in panel.
 * @returns {string | null} Updated mounted tag.
 */
function reconcile(panel, currentTag, nextTag) {
  if (currentTag === nextTag) return currentTag
  if (currentTag) {
    const old = panel.querySelector(currentTag)
    if (old) old.remove()
  }
  if (nextTag) {
    const el = panel.ownerDocument ? panel.ownerDocument.createElement(nextTag) : { tagName: nextTag.toUpperCase(), removed: false }
    panel.appendChild(el)
  }
  return nextTag
}

function createMockPanel() {
  const children = []
  return {
    children,
    querySelector(tag) {
      return children.find((child) => child.tagName.toLowerCase() === tag.toLowerCase()) ?? null
    },
    appendChild(el) {
      children.push(el)
      el.parent = this
    },
    ownerDocument: {
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          removed: false,
          remove() {
            this.removed = true
            if (this.parent) {
              const idx = this.parent.children.indexOf(this)
              if (idx !== -1) this.parent.children.splice(idx, 1)
            }
          }
        }
      }
    }
  }
}

test('reconcile mounts element when current tag is null', () => {
  const panel = createMockPanel()
  const mounted = reconcile(panel, null, 'extension-placeholder')

  assert.equal(mounted, 'extension-placeholder')
  assert.equal(panel.children.length, 1)
  assert.equal(panel.children[0].tagName, 'EXTENSION-PLACEHOLDER')
})

test('reconcile does nothing when current tag equals next tag', () => {
  const panel = createMockPanel()
  const mounted1 = reconcile(panel, null, 'extension-placeholder')
  const initialChild = panel.children[0]

  const mounted2 = reconcile(panel, mounted1, 'extension-placeholder')

  assert.equal(mounted2, 'extension-placeholder')
  assert.equal(panel.children.length, 1)
  assert.equal(panel.children[0], initialChild)
})

test('reconcile swaps element when tag changes', () => {
  const panel = createMockPanel()
  const mounted1 = reconcile(panel, null, 'tag-a')
  assert.equal(panel.children[0].tagName, 'TAG-A')

  const mounted2 = reconcile(panel, mounted1, 'tag-b')

  assert.equal(mounted2, 'tag-b')
  assert.equal(panel.children.length, 1)
  assert.equal(panel.children[0].tagName, 'TAG-B')
})

test('reconcile clears panel when next tag is null', () => {
  const panel = createMockPanel()
  const mounted1 = reconcile(panel, null, 'tag-a')
  assert.equal(panel.children.length, 1)

  const mounted2 = reconcile(panel, mounted1, null)

  assert.equal(mounted2, null)
  assert.equal(panel.children.length, 0)
})

test('reconcile handles null to null gracefully', () => {
  const panel = createMockPanel()
  const mounted = reconcile(panel, null, null)

  assert.equal(mounted, null)
  assert.equal(panel.children.length, 0)
})
