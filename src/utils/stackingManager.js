/**
 * Global Stacking Context & Dynamic Z-Index Manager
 * Manages the z-index stack for Bootstrap modals and offcanvas components.
 * Relocates nested modals to document.body to escape parent stacking contexts.
 * 
 * @returns {object} The manager control interface containing handle(type, target).
 */
export function initStackingManager() {
  const activeStack = []
  const originalPlacements = new WeakMap()

  const refreshZIndices = () => {
    activeStack.forEach((el, index) => {
      const baseZIndex = 1040 + index * 20

      // If this element has a captured backdrop, set its z-index
      if (el.__backdrop) {
        el.__backdrop.style.setProperty('z-index', String(baseZIndex), 'important')
      }

      // Set the z-index of the modal or offcanvas itself
      el.style.setProperty('z-index', String(baseZIndex + 10), 'important')
    })
  }

  const detectBackdropForElement = (el, callback) => {
    const selector = '.modal-backdrop, .offcanvas-backdrop'
    const initialBackdrops = Array.from(document.querySelectorAll(selector))

    let framesChecked = 0
    const check = () => {
      const currentBackdrops = Array.from(document.querySelectorAll(selector))
      const added = currentBackdrops.find(b => !initialBackdrops.includes(b))
      if (added) {
        callback(added)
      } else if (framesChecked < 10) {
        framesChecked++
        requestAnimationFrame(check)
      }
    }
    requestAnimationFrame(check)
  }

  const onShowModal = (modal) => {
    // Check if this modal is nested inside an offcanvas or another modal
    const nestedParent = modal.parentElement?.closest('.offcanvas, .modal')
    if (nestedParent) {
      console.log('[StackingManager] Relocating modal to body to escape stacking context:', modal)
      originalPlacements.set(modal, {
        parent: modal.parentNode,
        nextSibling: modal.nextSibling
      })
      document.body.appendChild(modal)
    }

    // Push to activeStack
    if (!activeStack.includes(modal)) {
      activeStack.push(modal)
    }

    detectBackdropForElement(modal, (backdrop) => {
      modal.__backdrop = backdrop
      refreshZIndices()
    })

    refreshZIndices()
  }

  const onHiddenModal = (modal) => {
    const index = activeStack.indexOf(modal)
    if (index !== -1) {
      activeStack.splice(index, 1)
    }

    // Restore to original location if relocated
    const placement = originalPlacements.get(modal)
    if (placement) {
      console.log('[StackingManager] Restoring modal to its original DOM position:', modal)
      placement.parent.insertBefore(modal, placement.nextSibling)
      originalPlacements.delete(modal)
    }

    // Clean up styling and backdrop reference
    modal.style.removeProperty('z-index')
    if (modal.__backdrop) {
      modal.__backdrop = null
    }

    refreshZIndices()
  }

  const onShowOffcanvas = (offcanvas) => {
    if (!activeStack.includes(offcanvas)) {
      activeStack.push(offcanvas)
    }

    detectBackdropForElement(offcanvas, (backdrop) => {
      offcanvas.__backdrop = backdrop
      refreshZIndices()
    })

    refreshZIndices()
  }

  const onHiddenOffcanvas = (offcanvas) => {
    const index = activeStack.indexOf(offcanvas)
    if (index !== -1) {
      activeStack.splice(index, 1)
    }

    offcanvas.style.removeProperty('z-index')
    if (offcanvas.__backdrop) {
      offcanvas.__backdrop = null
    }

    refreshZIndices()
  }

  return {
    handle(type, target) {
      if (type === 'show.bs.modal') onShowModal(target)
      else if (type === 'hidden.bs.modal') onHiddenModal(target)
      else if (type === 'show.bs.offcanvas') onShowOffcanvas(target)
      else if (type === 'hidden.bs.offcanvas') onHiddenOffcanvas(target)
    }
  }
}
