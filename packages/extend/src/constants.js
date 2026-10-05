/**
 * Current version of the Extension SDK API.
 */
export const EXTENSION_API_VERSION = '1.0.0'

/**
 * Reserved detail/list route identifiers that extensions cannot declare.
 */
export const RESERVED_ROUTES = Object.freeze(['index', '404'])

/**
 * Reserved preference keys that extensions cannot declare.
 */
export const RESERVED_PREFERENCE_KEYS = Object.freeze(['room_order'])

/**
 * Reserved preference key prefixes that extensions cannot declare.
 */
export const RESERVED_PREFERENCE_PREFIXES = Object.freeze(['_system:'])

/**
 * Reserved slot identifiers that extensions cannot declare.
 */
export const RESERVED_SLOTS = Object.freeze([])

/**
 * Allowlist of valid extension permission names.
 */
export const PERMISSIONS = Object.freeze([
  'network',
  'storage'
])

/**
 * Supported client platform categories.
 */
export const PLATFORMS = Object.freeze(['mobile', 'tablet', 'desktop'])

/**
 * Supported view surface modes.
 */
export const SURFACES = Object.freeze(['panel', 'overlay'])

/**
 * Regex pattern for validating preference keys.
 */
export const PREFERENCE_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/

/**
 * Regex pattern for validating event names (e.g. "namespace:event-name").
 */
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/

/**
 * Regex pattern for validating route identifiers.
 */
export const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Regex pattern for validating extension IDs.
 */
export const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/

/**
 * Regex pattern for validating semver API version strings.
 */
export const API_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/

/**
 * Regex pattern for validating component custom element tag names.
 */
export const COMPONENT_TAG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/

/**
 * Regex pattern for validating event schema field types (e.g. "string", "number?", "foo|bar").
 */
export const SCHEMA_TYPE_PATTERN = /^(string|number|boolean)(\?)?$|^[a-z][a-z0-9-]*(\|[a-z][a-z0-9-]*)+$/
