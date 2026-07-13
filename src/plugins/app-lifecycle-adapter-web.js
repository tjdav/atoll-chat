/**
 * Creates an instance of the Web App Lifecycle Adapter.
 *
 * @param {Object} [_instanceContext] Optional instance context for future extension.
 * @returns {Object} An object exposing the life cycle adapter API.
 */
export function createWebAppLifecycleAdapter (_instanceContext) {
  return {
    /**
     * Registers native browser visibility change listeners to detect foregrounding.
     *
     * @param {Object} bus The global event bus.
     */
    registerListeners (bus) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          console.info('[WebAppLifecycleAdapter] Browser tab is visible. Emitting app:foreground.')
          bus.emit('app:foreground')
        }
      })
    }
  }
}
