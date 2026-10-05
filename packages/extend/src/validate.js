import {
  API_VERSION_PATTERN,
  COMPONENT_TAG_PATTERN,
  EVENT_NAME_PATTERN,
  ID_PATTERN,
  PERMISSIONS,
  PREFERENCE_KEY_PATTERN,
  RESERVED_PREFERENCE_KEYS,
  RESERVED_PREFERENCE_PREFIXES,
  RESERVED_ROUTES,
  RESERVED_SLOTS,
  ROUTE_PATTERN,
  SCHEMA_TYPE_PATTERN
} from './constants.js'

const FIRST_PARTY_ALLOWLIST = new Set([
  'core.chat',
  'core.media',
  'core.documents',
  'core.links',
  'core.calls',
  'core.settings',
  'core.hangouts',
  'core.profile',
  'core.join',
  'core.admin',
  'core.calling',
  'core.whiteboard',
  'core.search',
  'core.files',
  'core.notifications'
])
const ALLOWED_PREFERENCE_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array'])
const SLOT_TARGET_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/

/**
 * Validates the detailed shape of an extension definition object.
 * Throws a plain Error with a descriptive message in the form
 * `<context>: <reason>. <suggestion>` on validation failure.
 *
 * @param {object} ext - Extension definition object.
 */
export function validateExtensionShape(ext) {
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) {
    throw new Error('Extension definition must be a plain object')
  }

  // id
  if (typeof ext.id !== 'string' || !ext.id) {
    throw new Error('Extension id must be a non-empty string')
  }
  if (!ID_PATTERN.test(ext.id)) {
    throw new Error(`extension '${ext.id}': id must match ^[a-z0-9]+(\\.[a-z0-9-]+)+$. Use lowercase alphanumeric dot-separated sections.`)
  }
  if (ext.id.startsWith('core.') && !FIRST_PARTY_ALLOWLIST.has(ext.id)) {
    throw new Error(`extension '${ext.id}': id prefix 'core.' is reserved for first-party extensions. Use a vendor prefix like 'vendor.myext'.`)
  }

  const extCtx = `extension '${ext.id}'`

  // apiVersion
  if (typeof ext.apiVersion !== 'string' || !ext.apiVersion) {
    throw new Error(`${extCtx}: apiVersion must be a non-empty string. Declare a valid semver version string like '1.0.0'.`)
  }
  if (!API_VERSION_PATTERN.test(ext.apiVersion)) {
    throw new Error(`${extCtx}: apiVersion must be a valid semver string. Declare a valid semver version string like '1.0.0'.`)
  }

  // hostApi
  if (typeof ext.hostApi !== 'string' || !ext.hostApi) {
    throw new Error(`${extCtx}: hostApi must be a non-empty string. Specify the minimum host API version supported.`)
  }

  // label required if rail is present
  if (ext.rail !== null && ext.rail !== undefined) {
    if (ext.label === null || ext.label === undefined || (typeof ext.label !== 'string' && typeof ext.label !== 'function')) {
      throw new Error(`${extCtx}: label is required when rail is declared. Provide a label string or getter.`)
    }
  }

  // detail
  if (!ext.detail || typeof ext.detail !== 'object' || Array.isArray(ext.detail)) {
    throw new Error(`${extCtx}: detail must be a plain object. Provide a detail view configuration object.`)
  }
  if (typeof ext.detail.route !== 'string' || !ext.detail.route) {
    throw new Error(`${extCtx}.detail.route: detail.route must be a non-empty string. Provide a valid kebab-case route name.`)
  }
  if (!ROUTE_PATTERN.test(ext.detail.route)) {
    throw new Error(`${extCtx}.detail.route: detail.route must match ^[a-z][a-z0-9-]*$. Use lowercase kebab-case string.`)
  }
  if (RESERVED_ROUTES.includes(ext.detail.route)) {
    throw new Error(`${extCtx}.detail.route: detail.route '${ext.detail.route}' is reserved. Reserved routes: ${RESERVED_ROUTES.join(', ')}. Use a custom route name.`)
  }
  if (typeof ext.detail.component !== 'string' || !ext.detail.component) {
    throw new Error(`${extCtx}.detail.component: detail.component must be a non-empty string. Provide a custom element tag name.`)
  }
  validateComponentTag(ext, `${extCtx}.detail.component`, ext.detail.component)

  if (typeof ext.detail.title !== 'string' && typeof ext.detail.title !== 'function') {
    throw new Error(`${extCtx}.detail.title: detail.title must be a non-empty string or function. Provide a title string or getter.`)
  }

  // list (optional)
  if (ext.list !== null && ext.list !== undefined) {
    if (typeof ext.list !== 'object' || Array.isArray(ext.list)) {
      throw new Error(`${extCtx}.list: list must be a plain object. Provide a list view configuration object.`)
    }
    if (typeof ext.list.route !== 'string' || !ext.list.route) {
      throw new Error(`${extCtx}.list.route: list.route must be a non-empty string. Provide a valid kebab-case route name.`)
    }
    if (!ROUTE_PATTERN.test(ext.list.route)) {
      throw new Error(`${extCtx}.list.route: list.route must match ^[a-z][a-z0-9-]*$. Use lowercase kebab-case string.`)
    }
    if (RESERVED_ROUTES.includes(ext.list.route)) {
      throw new Error(`${extCtx}.list.route: list.route '${ext.list.route}' is reserved. Reserved routes: ${RESERVED_ROUTES.join(', ')}. Use a custom route name.`)
    }
    if (typeof ext.list.component !== 'string' || !ext.list.component) {
      throw new Error(`${extCtx}.list.component: list.component must be a non-empty string. Provide a custom element tag name.`)
    }
    validateComponentTag(ext, `${extCtx}.list.component`, ext.list.component)

    if (typeof ext.list.title !== 'string' && typeof ext.list.title !== 'function') {
      throw new Error(`${extCtx}.list.title: list.title must be a non-empty string or function. Provide a title string or getter.`)
    }
  }

  // rail (optional)
  if (ext.rail !== null && ext.rail !== undefined) {
    if (typeof ext.rail !== 'object' || Array.isArray(ext.rail)) {
      throw new Error(`${extCtx}.rail: rail must be a plain object. Provide a rail configuration object.`)
    }
    if (!ext.rail.icon || typeof ext.rail.icon !== 'object' || typeof ext.rail.icon.name !== 'string' || !ext.rail.icon.name) {
      throw new Error(`${extCtx}.rail.icon: rail.icon.name must be a non-empty string. Provide a valid icon name object.`)
    }
    if (typeof ext.rail.order !== 'number' || !Number.isFinite(ext.rail.order)) {
      throw new Error(`${extCtx}.rail.order: rail.order must be a finite number. Specify a numeric order index.`)
    }
  }

  // Ensure array container checks
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
      throw new Error(`${extCtx}.${field}: field must be an array. Provide an array of ${field} definitions.`)
    }
  }

  // 1. Permissions
  if (Array.isArray(ext.permissions)) {
    ext.permissions.forEach((perm, idx) => {
      const pCtx = `${extCtx}.permissions[${idx}]`
      if (typeof perm !== 'string' || !PERMISSIONS.includes(perm)) {
        throw new Error(`${pCtx}: unknown permission '${perm}'. Allowed: ${PERMISSIONS.join(', ')}.`)
      }
    })
  }

  // 2. Slots
  if (Array.isArray(ext.slots)) {
    ext.slots.forEach((item, idx) => {
      const sCtx = `${extCtx}.slots[${idx}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`${sCtx}: slot item must be a plain object. Provide slot mounting properties.`)
      }
      if (typeof item.slot !== 'string' || !SLOT_TARGET_PATTERN.test(item.slot)) {
        throw new Error(`${sCtx}.slot: invalid slot format '${item.slot}'. Expected <shortId>.<slotName>.`)
      }
      if (RESERVED_SLOTS.includes(item.slot)) {
        throw new Error(`${sCtx}.slot: slot '${item.slot}' is reserved. Reserved slots: ${RESERVED_SLOTS.join(', ')}.`)
      }
      if (typeof item.component !== 'string' || !COMPONENT_TAG_PATTERN.test(item.component)) {
        throw new Error(`${sCtx}.component: component '${item.component}' must be a valid hyphenated custom element tag name.`)
      }
      validateComponentTag(ext, `${sCtx}.component`, item.component)

      if (typeof item.order !== 'number' || !Number.isFinite(item.order)) {
        throw new Error(`${sCtx}.order: order must be a finite number. Specify numeric slot ordering.`)
      }
      if (item.visible !== undefined && item.visible !== null && typeof item.visible !== 'function') {
        throw new Error(`${sCtx}.visible: visible must be a function or null/undefined. Provide a visibility predicate function.`)
      }
    })
  }

  // 3. Emits / PublicEvents
  const validateEventDecl = (eventList, fieldName) => {
    if (!Array.isArray(eventList)) return
    eventList.forEach((item, idx) => {
      const eCtx = `${extCtx}.${fieldName}[${idx}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`${eCtx}: item must be a plain object. Provide event declaration details.`)
      }
      if (typeof item.event !== 'string' || !EVENT_NAME_PATTERN.test(item.event)) {
        throw new Error(`${eCtx}.event: invalid event name '${item.event}'. Expected format <namespace>:<event-name>.`)
      }
      if (item.schema !== undefined && item.schema !== null) {
        if (typeof item.schema !== 'object' || Array.isArray(item.schema)) {
          throw new Error(`${eCtx}.schema: schema must be a plain object. Provide key-type mapping object.`)
        }
        for (const [sKey, sVal] of Object.entries(item.schema)) {
          if (typeof sVal !== 'string' || !SCHEMA_TYPE_PATTERN.test(sVal)) {
            throw new Error(`${eCtx}.schema.${sKey}: invalid schema type '${sVal}'. Expected primitive or union schema type string.`)
          }
        }
      }
    })
  }
  validateEventDecl(ext.emits, 'emits')
  validateEventDecl(ext.publicEvents, 'publicEvents')

  // 4. Listens
  if (Array.isArray(ext.listens)) {
    ext.listens.forEach((item, idx) => {
      const lCtx = `${extCtx}.listens[${idx}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`${lCtx}: item must be a plain object. Provide listener details.`)
      }
      if (typeof item.event !== 'string' || !EVENT_NAME_PATTERN.test(item.event)) {
        throw new Error(`${lCtx}.event: invalid event name '${item.event}'. Expected format <namespace>:<event-name>.`)
      }
      if (typeof item.handler !== 'function') {
        throw new Error(`${lCtx}.handler: listener handler must be a function.`)
      }
    })
  }

  // 5. Sessions
  if (Array.isArray(ext.sessions)) {
    ext.sessions.forEach((item, idx) => {
      const sessCtx = `${extCtx}.sessions[${idx}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`${sessCtx}: session definition must be a plain object.`)
      }
      if (typeof item.type !== 'string' || !/^[a-z][a-z0-9-]*$/.test(item.type)) {
        throw new Error(`${sessCtx}.type: session type '${item.type}' must be lowercase kebab-case string.`)
      }
      if (typeof item.maxParticipants !== 'number' || !Number.isInteger(item.maxParticipants) || item.maxParticipants <= 0) {
        throw new Error(`${sessCtx}.maxParticipants: maxParticipants must be a positive integer.`)
      }
      if (typeof item.maxPerRoom !== 'number' || !Number.isInteger(item.maxPerRoom) || item.maxPerRoom <= 0) {
        throw new Error(`${sessCtx}.maxPerRoom: maxPerRoom must be a positive integer.`)
      }
      if (typeof item.heartbeatInterval !== 'number' || !Number.isInteger(item.heartbeatInterval) || item.heartbeatInterval <= 0) {
        throw new Error(`${sessCtx}.heartbeatInterval: heartbeatInterval must be a positive integer in seconds.`)
      }
      if (item.metadata !== undefined && item.metadata !== null) {
        if (typeof item.metadata !== 'object' || Array.isArray(item.metadata)) {
          throw new Error(`${sessCtx}.metadata: metadata must be a plain object.`)
        }
        for (const [mKey, mVal] of Object.entries(item.metadata)) {
          if (typeof mVal !== 'string') {
            throw new Error(`${sessCtx}.metadata.${mKey}: session metadata values must be strings.`)
          }
        }
      }
      if (item.signaling !== undefined && item.signaling !== null) {
        if (typeof item.signaling !== 'object' || Array.isArray(item.signaling)) {
          throw new Error(`${sessCtx}.signaling: signaling must be a plain object.`)
        }
        for (const [sigKey, sigVal] of Object.entries(item.signaling)) {
          if (!sigVal || typeof sigVal !== 'object' || Array.isArray(sigVal)) {
            throw new Error(`${sessCtx}.signaling.${sigKey}: signaling entry must be a plain object.`)
          }
          for (const [k, v] of Object.entries(sigVal)) {
            if (typeof v !== 'string') {
              throw new Error(`${sessCtx}.signaling.${sigKey}.${k}: signaling entry values must be strings.`)
            }
          }
        }
      }
    })
  }

  // 6. Preferences
  if (Array.isArray(ext.preferences)) {
    ext.preferences.forEach((item, idx) => {
      const prefCtx = `${extCtx}.preferences[${idx}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`${prefCtx}: preference definition must be a plain object.`)
      }
      if (typeof item.key !== 'string') {
        throw new Error(`${prefCtx}.key: preference key must be a string.`)
      }
      if (RESERVED_PREFERENCE_KEYS.includes(item.key)) {
        throw new Error(`${prefCtx}.key: preference key '${item.key}' is reserved. Reserved keys: ${RESERVED_PREFERENCE_KEYS.join(', ')}.`)
      }
      for (const pfx of RESERVED_PREFERENCE_PREFIXES) {
        if (item.key.startsWith(pfx)) {
          throw new Error(`${prefCtx}.key: preference key '${item.key}' uses reserved prefix '${pfx}'.`)
        }
      }
      if (!PREFERENCE_KEY_PATTERN.test(item.key)) {
        throw new Error(`${prefCtx}.key: preference key '${item.key}' must match ^[a-z][a-zA-Z0-9]*$.`)
      }
      if (typeof item.type !== 'string' || !ALLOWED_PREFERENCE_TYPES.has(item.type)) {
        throw new Error(`${prefCtx}.type: preference type '${item.type}' is invalid. Allowed: ${Array.from(ALLOWED_PREFERENCE_TYPES).join(', ')}.`)
      }
      if (item.label !== undefined && item.label !== null && (typeof item.label !== 'string' || !item.label)) {
        throw new Error(`${prefCtx}.label: preference label must be a non-empty string or undefined.`)
      }
    })
  }

  // 7. Assets
  if (Array.isArray(ext.assets)) {
    ext.assets.forEach((item, idx) => {
      const aCtx = `${extCtx}.assets[${idx}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`${aCtx}: asset definition must be a plain object.`)
      }
      if (typeof item.src !== 'string' || !item.src) {
        throw new Error(`${aCtx}.src: src must be a non-empty string path.`)
      }
      if (typeof item.dest !== 'string' || !item.dest) {
        throw new Error(`${aCtx}.dest: dest must be a non-empty string path.`)
      }
    })
  }

  // 8. Locales
  if (ext.locales !== undefined && ext.locales !== null) {
    if (typeof ext.locales !== 'object' || Array.isArray(ext.locales)) {
      throw new Error(`${extCtx}.locales: locales must be a plain object.`)
    }
    if (typeof ext.locales.default !== 'string' || !ext.locales.default) {
      throw new Error(`${extCtx}.locales.default: default locale must be a non-empty string.`)
    }
    if (!ext.locales.files || typeof ext.locales.files !== 'object' || Array.isArray(ext.locales.files)) {
      throw new Error(`${extCtx}.locales.files: locale files map must be a plain object.`)
    }
    for (const [locKey, locFile] of Object.entries(ext.locales.files)) {
      if (typeof locFile !== 'string' || !locFile) {
        throw new Error(`${extCtx}.locales.files.${locKey}: locale file path must be a non-empty string.`)
      }
    }
  }

  // Lifecycle hooks
  const hookFields = ['onRegister', 'onActivate', 'onDeactivate']
  for (const field of hookFields) {
    if (ext[field] !== null && ext[field] !== undefined && typeof ext[field] !== 'function') {
      throw new Error(`${extCtx}.${field}: lifecycle hook must be a function or null.`)
    }
  }
}

/**
 * Validates custom element component tag naming rules.
 */
function validateComponentTag(ext, contextPath, tagName) {
  if (!COMPONENT_TAG_PATTERN.test(tagName)) {
    throw new Error(`${contextPath}: component '${tagName}' must be a valid hyphenated custom element tag name matching ^[a-z][a-z0-9]*(-[a-z0-9]+)+$.`)
  }
  if (!ext.id.startsWith('core.')) {
    const slug = ext.id.split('.').pop()
    const requiredPrefix = `x-${slug}-`
    if (!tagName.startsWith(requiredPrefix)) {
      throw new Error(`${contextPath}: component '${tagName}' must start with '${requiredPrefix}' for extension '${ext.id}'. Use '${requiredPrefix}${tagName}'.`)
    }
  }
}
