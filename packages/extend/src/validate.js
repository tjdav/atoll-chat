const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/
const API_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/

const FIRST_PARTY_ALLOWLIST = new Set([])

/**
 * Validates the basic shape of an extension definition object.
 * Throws a plain Error with a descriptive message on failure.
 *
 * @param {object} ext - Extension definition object.
 */
export function validateExtensionShape(ext) {
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) {
    throw new Error('Extension definition must be a plain object')
  }

  // id
  if (typeof ext.id !== 'string' || !ext.id) {
    throw new Error("Extension id must be a non-empty string")
  }
  if (!ID_PATTERN.test(ext.id)) {
    throw new Error(`Extension '${ext.id}': id must match ^[a-z0-9]+(\\.[a-z0-9-]+)+$`)
  }
  if (ext.id.startsWith('core.') && !FIRST_PARTY_ALLOWLIST.has(ext.id)) {
    throw new Error(`Extension '${ext.id}': id prefix 'core.' is reserved for first-party extensions`)
  }

  const prefix = `Extension '${ext.id}'`

  // apiVersion
  if (typeof ext.apiVersion !== 'string' || !ext.apiVersion) {
    throw new Error(`${prefix}: apiVersion must be a non-empty string`)
  }
  if (!API_VERSION_PATTERN.test(ext.apiVersion)) {
    throw new Error(`${prefix}: apiVersion must be a valid semver string`)
  }

  // hostApi
  if (typeof ext.hostApi !== 'string' || !ext.hostApi) {
    throw new Error(`${prefix}: hostApi must be a non-empty string`)
  }

  // rail presence requires label
  if (ext.rail !== null && ext.rail !== undefined) {
    if (ext.label === null || ext.label === undefined || (typeof ext.label !== 'string' && typeof ext.label !== 'function')) {
      throw new Error(`${prefix}: label is required when rail is declared`)
    }
  }

  // detail
  if (!ext.detail || typeof ext.detail !== 'object' || Array.isArray(ext.detail)) {
    throw new Error(`${prefix}: detail must be a plain object`)
  }
  if (typeof ext.detail.route !== 'string' || !ext.detail.route) {
    throw new Error(`${prefix}: detail.route must be a non-empty string`)
  }
  if (!ROUTE_PATTERN.test(ext.detail.route)) {
    throw new Error(`${prefix}: detail.route must match ^[a-z][a-z0-9-]*$`)
  }
  if (typeof ext.detail.component !== 'string' || !ext.detail.component) {
    throw new Error(`${prefix}: detail.component must be a non-empty string`)
  }
  if (typeof ext.detail.title !== 'string' && typeof ext.detail.title !== 'function') {
    throw new Error(`${prefix}: detail.title must be a non-empty string or function`)
  }

  // list (optional)
  if (ext.list !== null && ext.list !== undefined) {
    if (typeof ext.list !== 'object' || Array.isArray(ext.list)) {
      throw new Error(`${prefix}: list must be a plain object`)
    }
    if (typeof ext.list.route !== 'string' || !ext.list.route) {
      throw new Error(`${prefix}: list.route must be a non-empty string`)
    }
    if (!ROUTE_PATTERN.test(ext.list.route)) {
      throw new Error(`${prefix}: list.route must match ^[a-z][a-z0-9-]*$`)
    }
    if (typeof ext.list.component !== 'string' || !ext.list.component) {
      throw new Error(`${prefix}: list.component must be a non-empty string`)
    }
    if (typeof ext.list.title !== 'string' && typeof ext.list.title !== 'function') {
      throw new Error(`${prefix}: list.title must be a non-empty string or function`)
    }
  }

  // rail (optional)
  if (ext.rail !== null && ext.rail !== undefined) {
    if (typeof ext.rail !== 'object' || Array.isArray(ext.rail)) {
      throw new Error(`${prefix}: rail must be a plain object`)
    }
    if (!ext.rail.icon || typeof ext.rail.icon !== 'object' || typeof ext.rail.icon.name !== 'string' || !ext.rail.icon.name) {
      throw new Error(`${prefix}: rail.icon.name must be a non-empty string`)
    }
    if (typeof ext.rail.order !== 'number' || !Number.isFinite(ext.rail.order)) {
      throw new Error(`${prefix}: rail.order must be a finite number`)
    }
  }

  // Array fields
  const arrayFields = [
    'permissions',
    'slots',
    'emits',
    'publicEvents',
    'listens',
    'sessions',
    'preferences',
    'assets'
  ]
  for (const field of arrayFields) {
    if (ext[field] !== null && ext[field] !== undefined && !Array.isArray(ext[field])) {
      throw new Error(`${prefix}: ${field} must be an array`)
    }
  }

  // Lifecycle hooks
  const hookFields = ['onRegister', 'onActivate', 'onDeactivate']
  for (const field of hookFields) {
    if (ext[field] !== null && ext[field] !== undefined && typeof ext[field] !== 'function') {
      throw new Error(`${prefix}: ${field} must be a function or null`)
    }
  }
}
