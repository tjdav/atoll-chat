import * as chatRoundLineMod from '@solar-icons/static/linear/chat-round-line'
import * as galleryMod from '@solar-icons/static/linear/gallery'
import * as documentTextMod from '@solar-icons/static/linear/document-text'
import * as linkMod from '@solar-icons/static/linear/link'
import * as phoneMod from '@solar-icons/static/linear/phone'
import * as settingsMod from '@solar-icons/static/linear/settings'

/**
 * Helper to extract raw SVG markup string from a module object or value.
 * Handles default exports, named exports, and direct string values.
 *
 * @param {unknown} mod - Imported icon module or string.
 * @returns {string} Extracted SVG markup string.
 */
function extractSvg(mod) {
  if (typeof mod === 'string') return mod
  if (mod && typeof mod === 'object') {
    if ('default' in mod && typeof mod.default === 'string') {
      return mod.default
    }
    for (const [key, val] of Object.entries(mod)) {
      if (typeof val === 'string' && val.includes('<svg')) {
        return val
      }
    }
  }
  return ''
}

/**
 * Mapping of canonical icon names to their normalized SVG string representation.
 * @type {Readonly<Record<string, string>>}
 */
export const SOLAR_MAP = Object.freeze({
  'chat-round-line': extractSvg(chatRoundLineMod),
  'gallery': extractSvg(galleryMod),
  'document-text': extractSvg(documentTextMod),
  'link': extractSvg(linkMod),
  'phone': extractSvg(phoneMod),
  'settings': extractSvg(settingsMod)
})
