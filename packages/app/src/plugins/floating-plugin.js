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
         * Positions a floating element relative to a reference element or virtual element.
         *
         * @param {object} params - Positioning parameters.
         * @param {Element|object} params.reference - Reference DOM element or virtual element.
         * @param {HTMLElement} params.floating - Floating DOM element to position.
         * @param {string} [params.placement='bottom-start'] - Preferred placement.
         * @param {number} [params.offsetPx=6] - Offset from reference element in pixels.
         * @param {number} [params.padding=8] - Minimum padding from boundary edges in pixels.
         * @returns {Function} Cleanup function to stop autoUpdate.
         */
        function positionFloating({ reference, floating, placement = 'bottom-start', offsetPx = 6, padding = 8 }) {
          if (!reference || !floating) return () => {}

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
          return autoUpdate(reference, floating, update)
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
