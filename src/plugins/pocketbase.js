import { definePlugin } from 'coralite'

/**
 * PocketBase plugin loader.
 * @param {Object} options Plugin configuration options.
 * @param {string} [options.baseUrl='/'] The pocketbase API base URL.
 * @param {boolean} [options.enableWorkspaces=false] Multi-tenant build-time feature flag.
 */
export default function pocketbase (options = {}) {
  const url = options.baseUrl || '/'
  const enableWorkspaces = options.enableWorkspaces || false

  return definePlugin({
    name: 'pocketbase',
    server: {
      context: async () => {
        const { default: PocketBase } = await import('pocketbase')
        const pb = new PocketBase(url)
        pb.autoCancellation(false)

        return () => {
          return { pb }
        }
      }
    },
    client: {
      config: {
        url,
        enableWorkspaces
      },
      context: async (pluginContext) => {
        const { default: PocketBase, BaseAuthStore } = await import('pocketbase')
        const isWorkspacesEnabled = pluginContext.config.enableWorkspaces || (typeof window !== 'undefined' && window.__coralite_workspaces_override__)

        let pb
        let customStore = null

        if (isWorkspacesEnabled) {
          class WorkspaceAuthStore extends BaseAuthStore {
            constructor () {
              super()
              this.loadFromStorage()
            }

            loadFromStorage () {
              try {
                const stored = localStorage.getItem('atoll_workspaces')
                this.workspaces = stored ? JSON.parse(stored) : []
                const activeId = localStorage.getItem('atoll_active_workspace_id')
                this.activeWorkspaceId = activeId || (this.workspaces[0]?.id || null)
              } catch (_e) {
                this.workspaces = []
                this.activeWorkspaceId = null
              }
              this.syncActive()
            }

            saveWorkspaces () {
              localStorage.setItem('atoll_workspaces', JSON.stringify(this.workspaces))
              if (this.activeWorkspaceId) {
                localStorage.setItem('atoll_active_workspace_id', this.activeWorkspaceId)
              } else {
                localStorage.removeItem('atoll_active_workspace_id')
              }
            }

            syncActive () {
              const active = this.workspaces.find(w => w.id === this.activeWorkspaceId)
              if (active) {
                this.baseToken = active.token || ''
                this.baseModel = active.user || null
              } else {
                this.baseToken = ''
                this.baseModel = null
              }
            }

            save (token, model) {
              super.save(token, model)
              if (this.activeWorkspaceId) {
                const active = this.workspaces.find(w => w.id === this.activeWorkspaceId)
                if (active) {
                  active.token = token
                  active.user = model
                }
                this.saveWorkspaces()
              }
            }

            clear () {
              super.clear()
              if (this.activeWorkspaceId) {
                const active = this.workspaces.find(w => w.id === this.activeWorkspaceId)
                if (active) {
                  active.token = ''
                  active.user = null
                }
                this.saveWorkspaces()
              }
            }

            setActiveWorkspace (id) {
              this.activeWorkspaceId = id
              this.syncActive()
              this.saveWorkspaces()
            }

            addWorkspace (workspace) {
              const existingIndex = this.workspaces.findIndex(w => w.id === workspace.id)
              if (existingIndex !== -1) {
                this.workspaces[existingIndex] = {
                  ...this.workspaces[existingIndex],
                  ...workspace
                }
              } else {
                this.workspaces.push(workspace)
              }
              this.activeWorkspaceId = workspace.id
              this.syncActive()
              this.saveWorkspaces()
            }

            removeWorkspace (id) {
              this.workspaces = this.workspaces.filter(w => w.id !== id)
              if (this.activeWorkspaceId === id) {
                this.activeWorkspaceId = this.workspaces[0]?.id || null
              }
              this.syncActive()
              this.saveWorkspaces()
            }
          }

          customStore = new WorkspaceAuthStore()

          const active = customStore.workspaces.find(w => w.id === customStore.activeWorkspaceId)
          const activeUrl = active ? active.url : ''
          pb = new PocketBase(activeUrl, customStore)
        } else {
          pb = new PocketBase(pluginContext.config.url)
        }

        pb.autoCancellation(false)

        /* Override pb.buildURL to support dynamic pathing tests as well */
        const originalBuildURL = pb.buildURL.bind(pb)
        pb.buildURL = (path, params) => {
          const url = originalBuildURL(path, params)
          return url
        }

        return () => {
          return { pb }
        }
      }
    }
  })
}
