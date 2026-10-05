import { SOLAR_MAP } from './solar-map.js'

/**
 * List of canonical icon names permitted in the application.
 * @type {ReadonlyArray<string>}
 */
export const CANONICAL_ICONS = Object.freeze([
  'chat-round-line',
  'gallery',
  'document-text',
  'link',
  'phone',
  'settings'
])

/**
 * Resolves a canonical icon name to its SVG markup string.
 *
 * @param {string} name - Canonical icon name.
 * @returns {string} SVG markup string.
 * @throws {Error} If name is unknown or unmapped.
 */
export function getIconModule(name) {
  if (!CANONICAL_ICONS.includes(name)) {
    throw new Error(`Unknown icon: ${name}. Add it to CANONICAL_ICONS and SOLAR_MAP.`)
  }
  const mod = SOLAR_MAP[name]
  if (!mod) {
    throw new Error(`Icon "${name}" is canonical but not mapped.`)
  }
  return mod
}

/**
 * Checks whether an icon name is in the canonical set.
 *
 * @param {string} name - Icon name to check.
 * @returns {boolean} True if canonical, false otherwise.
 */
export function isIconName(name) {
  return CANONICAL_ICONS.includes(name)
}

/**
 * Returns a list of all canonical icon names.
 *
 * @returns {ReadonlyArray<string>} List of canonical icon names.
 */
export function listIcons() {
  return CANONICAL_ICONS
}
