/**
 * Creates an instance of the Native App Lifecycle Adapter.
 *
 * @param {Object} [_instanceContext] Optional instance context for future extension.
 * @returns {Object} An object exposing the life cycle adapter API.
 */
export function createNativeAppLifecycleAdapter (_instanceContext) {
  return {
    /**
     * Registers Capacitor App listeners to detect native platform foregrounding.
     *
     * @param {Object} bus The global event bus.
     * @returns {Promise<void>} Resolves when listeners have been successfully registered.
     */
    async registerListeners (bus) {
      try {
        const { App } = await import('@capacitor/app')
        await App.addListener('appStateChange', (state) => {
          if (state.isActive) {
            console.info('[NativeAppLifecycleAdapter] App is active. Emitting app:foreground.')
            bus.emit('app:foreground')
          }
        })
      } catch (err) {
        console.error('[NativeAppLifecycleAdapter] Failed to register @capacitor/app listeners:', err)
      }
    }
  }
}
