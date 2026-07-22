/**
 * @import { RecordModel } from 'pocketbase'
 */

import { BaseAuthStore } from 'pocketbase'

/**
 * Custom AuthStore implementing multi-tenant workspace / island state persistence.
 */
export class WorkspaceAuthStore extends BaseAuthStore {
  /**
   * Initializes the workspace auth store and restores active workspaces from localStorage.
   */
  constructor () {
    super()
    this.loadFromStorage()
  }

  /**
   * Loads saved workspace records and active workspace ID from localStorage.
   */
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

  /**
   * Persists workspace list and active workspace ID to localStorage.
   */
  saveWorkspaces () {
    localStorage.setItem('atoll_workspaces', JSON.stringify(this.workspaces))
    if (this.activeWorkspaceId) {
      localStorage.setItem('atoll_active_workspace_id', this.activeWorkspaceId)
    } else {
      localStorage.removeItem('atoll_active_workspace_id')
    }
  }

  /**
   * Synchronizes BaseAuthStore token and model with the active workspace entry.
   */
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

  /**
   * Saves authentication token and user model for the active workspace.
   *
   * @param {string} token JWT token string.
   * @param {RecordModel|null} model Authenticated user record.
   */
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

  /**
   * Clears authentication token and user model for the active workspace.
   */
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

  /**
   * Sets the active workspace ID and synchronizes auth state.
   *
   * @param {string} id Workspace ID string.
   */
  setActiveWorkspace (id) {
    this.activeWorkspaceId = id
    this.syncActive()
    this.saveWorkspaces()
  }

  /**
   * Adds or updates a workspace entry in local storage.
   *
   * @param {Object} workspace Workspace data object containing id, name, url, token, user.
   */
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

  /**
   * Removes a workspace entry by ID.
   *
   * @param {string} id Workspace ID string.
   */
  removeWorkspace (id) {
    this.workspaces = this.workspaces.filter(w => w.id !== id)
    if (this.activeWorkspaceId === id) {
      this.activeWorkspaceId = this.workspaces[0]?.id || null
    }
    this.syncActive()
    this.saveWorkspaces()
  }
}
