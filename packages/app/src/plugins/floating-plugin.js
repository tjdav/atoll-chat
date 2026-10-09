import { definePlugin } from 'coralite'
import { fileURLToPath } from 'node:url'

/**
 * Floating UI positioning plugin factory.
 *
 * @param {object} [options] - Plugin options.
 * @returns {import('coralite').Plugin} Plugin instance.
 */
export default (options = {}) => {
  return definePlugin({
    name: 'floating',
    rootDir: process.cwd(),
    filePath: fileURLToPath(import.meta.url),

    server: {
      context: (pluginContext) => (_instanceContext) => ({
        positionFloating: () => {
          throw new Error('floating.positionFloating is not available during SSR. Positioning is client-only.')
        },
        virtualElementFromPoint: () => {
          throw new Error('floating.virtualElementFromPoint is not available during SSR. Positioning is client-only.')
        }
      })
    },

    client: {
      context: async (pluginContext) => {
        const {
          computePosition,
          autoUpdate,
          offset: offsetMiddleware,
          flip: flipMiddleware,
          shift: shiftMiddleware
        } = await import('@floating-ui/dom')

        /**
         * Positions a floating element relative to a reference element and
         * wires teardown to an optional AbortSignal.
         *
         * @param {Object} args
         * @param {HTMLElement | { getBoundingClientRect: () => DOMRect }} args.reference
         * @param {HTMLElement} args.floating
         * @param {string} [args.placement='bottom-start']
         * @param {number} [args.offsetPx=6]
         * @param {number} [args.padding=8]
         * @param {AbortSignal} [signal] Optional. If provided, cleanup is invoked
         *   automatically when the signal aborts. If the signal is already aborted,
         *   the function returns a no-op without setting up positioning.
         * @returns {() => void} An idempotent cleanup function. Invoking it more
         *   than once is safe and has no effect after the first call.
         */
        function positionFloating({
          reference,
          floating,
          placement = 'bottom-start',
          offsetPx = 6,
          padding = 8
        }, signal) {
          if (!reference || !floating) return () => {}
          if (signal?.aborted) return () => {}

          let autoUpdateCleanup = null
          let cleaned = false

          function cleanup() {
            if (cleaned) return
            cleaned = true
            if (autoUpdateCleanup) {
              autoUpdateCleanup()
              autoUpdateCleanup = null
            }
            if (signal) {
              signal.removeEventListener('abort', cleanup)
            }
          }

          function update() {
            computePosition(reference, floating, {
              placement,
              strategy: 'fixed',
              middleware: [
                offsetMiddleware(offsetPx),
                flipMiddleware({ padding }),
                shiftMiddleware({ padding })
              ]
            }).then(({ x, y }) => {
              floating.style.left = `${x}px`
              floating.style.top = `${y}px`
            })
          }

          update()
          autoUpdateCleanup = autoUpdate(reference, floating, update)

          if (signal) {
            signal.addEventListener('abort', cleanup, { once: true })
          }

          return cleanup
        }

        /**
         * Creates a virtual element from viewport coordinates.
         *
         * @param {number} x - Viewport X coordinate.
         * @param {number} y - Viewport Y coordinate.
         * @param {Element} [contextElement] - Optional scroll context element.
         * @returns {{ getBoundingClientRect: Function, contextElement?: Element }} Virtual element.
         */
        function virtualElementFromPoint(x, y, contextElement) {
          const initialScrollTop = contextElement?.scrollTop || 0
          const initialScrollLeft = contextElement?.scrollLeft || 0
          return {
            ...(contextElement ? { contextElement } : {}),
            getBoundingClientRect() {
              const dy = (contextElement?.scrollTop || 0) - initialScrollTop
              const dx = (contextElement?.scrollLeft || 0) - initialScrollLeft
              const currentY = y - dy
              const currentX = x - dx
              return {
                x: currentX,
                y: currentY,
                top: currentY,
                left: currentX,
                right: currentX,
                bottom: currentY,
                width: 0,
                height: 0
              }
            }
          }
        }

        return (_instanceContext) => ({
          positionFloating,
          virtualElementFromPoint
        })
      }
    }
  })
}
