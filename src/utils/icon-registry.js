// src/utils/icon-registry.js
import * as duoIcons from 'duo-icons'

// Aliases for video mappings
const ALIASES = {
  video: 'computer_camera',
  'video-off': 'computer_camera-off',
  video_off: 'computer_camera-off',
  videoOff: 'computer_camera-off'
}

// Custom duotone SVG fallbacks with primary/secondary path layers
const CUSTOM_FALLBACKS = {
  mic: `
    <path class="duo-icon-secondary duo-icons-secondary-layer" fill="currentColor" opacity="0.35" d="M12 12c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2s-2 .9-2 2v5c0 1.1.9 2 2 2z" />
    <path class="duo-icon-primary duo-icons-primary-layer" fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 3-2.54 5.1-5 5.1S7 14 7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-2z" />
  `,
  mic_off: `
    <path class="duo-icon-secondary duo-icons-secondary-layer" fill="currentColor" opacity="0.35" d="M12 11c1.1 0 2-.9 2-2V4.5c0-1.1-.9-2-2-2s-2 .9-2 2V11z" />
    <path class="duo-icon-primary duo-icons-primary-layer" fill="currentColor" d="M12 1.5c-1.66 0-3 1.34-3 3v1.3l2 2V4.5c0-.55.45-1 1-1s1 .45 1 1v4.3l2 2V4.5c0-1.66-1.34-3-3-3zM5 11c0 2.62 1.88 4.78 4.38 5.27V19.5h3.24l2 2H9v-2.73A6.99 6.99 0 0 1 3 11h2zm13.78 11.28L2.5 6l1.28-1.28L20.06 21l-1.28 1.28zM17 11c0 1.1-.3 2.13-.82 3.01l1.47 1.47A8.93 8.93 0 0 0 19 11h-2z" />
  `,
  search: `
    <path class="duo-icon-secondary duo-icons-secondary-layer" fill="currentColor" opacity="0.35" d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z" />
    <path class="duo-icon-primary duo-icons-primary-layer" fill="currentColor" fill-rule="evenodd" d="M16.32 14.906a8 8 0 1 1 1.414-1.414l4.97 4.97a1 1 0 0 1-1.414 1.414l-4.97-4.97zM10 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12z" />
  `,
  phone: `
    <path class="duo-icon-secondary duo-icons-secondary-layer" fill="currentColor" opacity="0.35" d="M20 15.5c-1.2 0-2.4-.4-3.5-1.1l-1.8 1.8c-2.8-1.5-5.1-3.8-6.6-6.6l1.8-1.8C9.2 6.7 8.8 5.5 8.8 4.3c0-.8-.7-1.5-1.5-1.5H3.5C2.6 2.8 2 3.6 2 4.5c.8 9.5 8.2 17 17.5 17.5.9 0 1.7-.6 1.7-1.5v-3.5c0-.8-.7-1.5-1.7-1.5z" />
    <path class="duo-icon-primary duo-icons-primary-layer" fill="currentColor" d="M20.01 15.38c-1.23-.13-2.42-.52-3.53-1.15-.35-.2-.8-.16-1.12.15l-1.8 1.8c-2.82-1.48-5.12-3.78-6.6-6.6l1.8-1.8c.31-.31.35-.76.15-1.12C8.31 5.55 7.92 4.37 7.78 3.13c-.15-.81-.84-1.4-1.66-1.4H3.5C2.61 1.73 1.9 2.5 2 3.39c.8 10.05 8.76 18 18.8 18.8.89.09 1.66-.62 1.66-1.51v-3.64c0-.82-.59-1.51-1.45-1.66z" />
  `
}

/**
 * Normalizes an icon name by checking aliases and converting
 * camelCase and kebab-case inputs to snake_case.
 * @param {string} name
 * @returns {string}
 */
export function normalizeName (name) {
  if (!name) {
    return ''
  }
  if (ALIASES[name]) {
    return ALIASES[name]
  }

  // Convert camelCase to snake_case
  let normalized = name.replace(/([a-z])([A-Z])/g, '$1_$2')
  // Convert kebab-case to snake_case
  normalized = normalized.replace(/-/g, '_')

  return normalized.toLowerCase()
}

/**
 * Returns the raw SVG string for a requested icon name.
 * @param {string} name
 * @returns {string}
 */
export function getIconSvg (name) {
  if (!name) {
    return ''
  }

  const normalized = normalizeName(name)

  // Retrieve paths from custom fallbacks or from duo-icons
  const paths = CUSTOM_FALLBACKS[normalized] || duoIcons.icons[normalized]

  if (paths) {
    return `<svg viewBox="0 0 24 24" class="atoll-duo-icon" fill="none" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`
  }

  return ''
}
