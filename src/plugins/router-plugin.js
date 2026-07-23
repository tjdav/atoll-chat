import { definePlugin } from 'coralite'

/**
 * Router Plugin for Coralite
 * Manages SPA navigation using the History API and query parameters.
 * Tracks current view and active selection to enable deterministic back navigation.
 */
export default function routerPlugin () {
  return definePlugin({
    name: 'router',
    client: {
      context: (pluginContext) => {
        let pendingDeepLink = null
        let deepLinkApplied = false

        try {
          const params = new URLSearchParams(window.location.search)
          if (params.has('view')) {
            pendingDeepLink = {
              view: params.get('view'),
              id: params.get('id'),
              type: params.get('type'),
              messageId: params.get('messageId')
            }
          }
        } catch {
          // Ignore
        }

        return (instanceContext) => {
          const init = () => {
            // routing logic only runs once globally
            if (pluginContext.__router_active__) {
              return
            }
            pluginContext.__router_active__ = true

            // globalStore from instanceContext
            const gs = instanceContext.globalStore
            if (!gs || !gs.$state) {
              return
            }
            const { $state } = gs

            // Volatile flag to prevent infinite loops during popstate sync
            let isNavigatingFromPopstate = false

            // Cache for previous state to detect meaningful changes
            let lastUrlView = null
            let lastUrlId = null
            let lastUrlType = null

            /**
             * Synchronizes global state to the browser's History API.
             */
            const syncStateToUrl = () => {
              if (isNavigatingFromPopstate || !deepLinkApplied) {
                return
              }
              if (!$state.isAuthenticated || !$state.isVaultUnlocked) {
                return
              }

              const newView = $state.currentAppView || 'chats'
              const newId = $state.activeSelectionId
              const newType = $state.activeSelectionType

              if (newView === lastUrlView && newId === lastUrlId && newType === lastUrlType) {
                return
              }

              const nextParams = new URLSearchParams()
              nextParams.set('view', newView)
              if (newId) {
                nextParams.set('id', newId)
              }
              if (newType) {
                nextParams.set('type', newType)
              }

              const nextUrl = `${window.location.pathname}?${nextParams.toString()}`

              let action = 'replaceState'
              const viewChanged = newView !== lastUrlView
              const idChanged = newId !== lastUrlId

              if (viewChanged) {
                // sidebar move from deep view is push, from root is replace
                action = lastUrlId ? 'pushState' : 'replaceState'
              } else if (idChanged) {
                // drill down from root is push, item switch is replace
                action = !lastUrlId ? 'pushState' : 'replaceState'
              }

              lastUrlView = newView
              lastUrlId = newId
              lastUrlType = newType

              window.history[action]({
                view: newView,
                id: newId,
                type: newType
              }, '', nextUrl)
            }

            /**
             * Restores the application state from the URL (deep link) or syncs current state.
             */
            const applyInitialState = () => {
              if (deepLinkApplied || !$state.isAuthenticated || !$state.isVaultUnlocked) {
                return
              }
              deepLinkApplied = true

              const bus = instanceContext.eventBus?.$bus

              if (pendingDeepLink) {
                isNavigatingFromPopstate = true

                if (pendingDeepLink.view) {
                  $state.currentAppView = pendingDeepLink.view
                }
                if (pendingDeepLink.id) {
                  $state.activeSelectionId = pendingDeepLink.id
                }
                if (pendingDeepLink.type) {
                  $state.activeSelectionType = pendingDeepLink.type
                }
                if (pendingDeepLink.messageId && bus) {
                  const targetMsgId = pendingDeepLink.messageId
                  setTimeout(() => {
                    bus.emit('message:scroll_to', { messageId: targetMsgId })
                  }, 1500)
                }

                setTimeout(() => {
                  isNavigatingFromPopstate = false
                }, 0)
                pendingDeepLink = null
              }

              lastUrlView = $state.currentAppView || 'chats'
              lastUrlId = $state.activeSelectionId
              lastUrlType = $state.activeSelectionType

              const nextParams = new URLSearchParams()
              nextParams.set('view', lastUrlView)
              if (lastUrlId) {
                nextParams.set('id', lastUrlId)
              }
              if (lastUrlType) {
                nextParams.set('type', lastUrlType)
              }
              const nextUrl = `${window.location.pathname}?${nextParams.toString()}`

              window.history.replaceState({
                view: lastUrlView,
                id: lastUrlId,
                type: lastUrlType
              }, '', nextUrl)
            }

            const popstateHandler = (event) => {
              if (!$state.isAuthenticated || !$state.isVaultUnlocked) {
                return
              }

              isNavigatingFromPopstate = true
              const state = event.state
              if (state) {
                $state.currentAppView = state.view
                $state.activeSelectionId = state.id
                $state.activeSelectionType = state.type
              } else {
                const p = new URLSearchParams(window.location.search)
                $state.currentAppView = p.get('view') || 'chats'
                $state.activeSelectionId = p.get('id')
                $state.activeSelectionType = p.get('type')
              }

              lastUrlView = $state.currentAppView
              lastUrlId = $state.activeSelectionId
              lastUrlType = $state.activeSelectionType

              setTimeout(() => {
                isNavigatingFromPopstate = false
              }, 0)
            }

            window.addEventListener('popstate', popstateHandler)
            if (instanceContext.signal) {
              instanceContext.signal.addEventListener('abort', () => {
                window.removeEventListener('popstate', popstateHandler)
              })
            }

            $state.subscribe('isAuthenticated', () => applyInitialState())
            $state.subscribe('isVaultUnlocked', () => applyInitialState())
            $state.subscribe('currentAppView', () => syncStateToUrl())
            $state.subscribe('activeSelectionId', () => syncStateToUrl())
            $state.subscribe('activeSelectionType', () => syncStateToUrl())

            applyInitialState()
          }

          return { init }
        }
      }
    }
  })
}
