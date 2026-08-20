import {
  getContrastRatio,
  getRelativeLuminance,
  rgbToHex,
  hslToRgb
} from './color-contrast.js'

/**
 * Parses any supported CSS color representation into an RGBA array [r, g, b, a].
 * Supports: #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla(),
 * transparent, currentColor, and CSS variables var(--...).
 *
 * @param {string} colorStr - The color string to parse.
 * @param {Record<string, string>} [tokenMap={}] - Map of CSS variable names to values for var() resolution.
 * @returns {[number, number, number, number]} [r (0-255), g (0-255), b (0-255), a (0-1)]
 */
export function parseColorToRgb (colorStr, tokenMap = {}) {
  if (!colorStr || typeof colorStr !== 'string') {
    return [0, 0, 0, 1]
  }

  let clean = colorStr.trim().toLowerCase()

  // Resolve CSS variable var(--name, fallback)
  if (clean.startsWith('var(')) {
    const varMatch = clean.match(/^var\s*\(\s*--([a-zA-Z0-9_-]+)(?:\s*,\s*(.+))?\s*\)$/)
    if (varMatch) {
      const varName = varMatch[1]
      const fallback = varMatch[2]
      if (tokenMap[varName]) {
        return parseColorToRgb(tokenMap[varName], tokenMap)
      } else if (tokenMap[`--${varName}`]) {
        return parseColorToRgb(tokenMap[`--${varName}`], tokenMap)
      } else if (fallback) {
        return parseColorToRgb(fallback, tokenMap)
      }
    }
  }

  if (clean === 'transparent') {
    return [0, 0, 0, 0]
  }

  if (clean === 'currentcolor') {
    return [0, 0, 0, 1]
  }

  // Hex colors
  if (clean.startsWith('#')) {
    const hex = clean.substring(1)
    if (hex.length === 3) {
      // #RGB
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      return [r, g, b, 1]
    } else if (hex.length === 4) {
      // #RGBA
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      const a = parseInt(hex[3] + hex[3], 16) / 255
      return [r, g, b, a]
    } else if (hex.length === 6) {
      // #RRGGBB
      const r = parseInt(hex.substring(0, 2), 16)
      const g = parseInt(hex.substring(2, 4), 16)
      const b = parseInt(hex.substring(4, 6), 16)
      return [r, g, b, 1]
    } else if (hex.length === 8) {
      // #RRGGBBAA
      const r = parseInt(hex.substring(0, 2), 16)
      const g = parseInt(hex.substring(2, 4), 16)
      const b = parseInt(hex.substring(4, 6), 16)
      const a = parseInt(hex.substring(6, 8), 16) / 255
      return [r, g, b, a]
    }
  }

  // rgb() / rgba()
  const rgbaMatch = clean.match(/^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/)
  if (rgbaMatch) {
    const r = Math.min(255, Math.max(0, parseFloat(rgbaMatch[1])))
    const g = Math.min(255, Math.max(0, parseFloat(rgbaMatch[2])))
    const b = Math.min(255, Math.max(0, parseFloat(rgbaMatch[3])))
    const a = rgbaMatch[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(rgbaMatch[4]))) : 1
    return [r, g, b, a]
  }

  // hsl() / hsla()
  const hslaMatch = clean.match(/^hsla?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)$/)
  if (hslaMatch) {
    const h = parseFloat(hslaMatch[1])
    const s = parseFloat(hslaMatch[2])
    const l = parseFloat(hslaMatch[3])
    const a = hslaMatch[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(hslaMatch[4]))) : 1
    const [r, g, b] = hslToRgb(h, s, l)
    return [r, g, b, a]
  }

  // Fallback if parsing fails
  return [0, 0, 0, 1]
}

/**
 * Mathematically alpha-composites a foreground color (potentially translucent)
 * over a solid background color.
 *
 * Formula: C_out = C_fg * a_fg + C_bg * (1 - a_fg)
 *
 * @param {string|[number, number, number, number]} fgColor
 * @param {string|[number, number, number, number]} bgColor
 * @param {Record<string, string>} [tokenMap={}]
 * @returns {[number, number, number]} [r, g, b] solid RGB array
 */
export function compositeColor (fgColor, bgColor, tokenMap = {}) {
  const fg = typeof fgColor === 'string'
    ? parseColorToRgb(fgColor, tokenMap)
    : (Array.isArray(fgColor) && fgColor.length === 3 ? [...fgColor, 1] : fgColor)
  const bg = typeof bgColor === 'string'
    ? parseColorToRgb(bgColor, tokenMap)
    : (Array.isArray(bgColor) && bgColor.length === 3 ? [...bgColor, 1] : bgColor)

  const alpha = fg[3] !== undefined ? fg[3] : 1
  if (alpha >= 1) {
    return [fg[0], fg[1], fg[2]]
  }
  if (alpha <= 0) {
    return [bg[0], bg[1], bg[2]]
  }

  const r = Math.round(fg[0] * alpha + bg[0] * (1 - alpha))
  const g = Math.round(fg[1] * alpha + bg[1] * (1 - alpha))
  const b = Math.round(fg[2] * alpha + bg[2] * (1 - alpha))

  return [r, g, b]
}

/**
 * Validates a chat theme schema for WCAG 2.2 AA contrast compliance.
 *
 * @param {Object} themeObject - Custom theme object or predefined theme tokens.
 * @param {Object} [options]
 * @param {Record<string, string>} [options.tokenMap={}] - Token map for variable resolution.
 * @returns {{ pass: boolean, groups: Record<string, { pass: boolean, checks: Array<{ name: string, ratio: number, minRatio: number, pass: boolean, fg: string, bg: string }> }>, failures: Array<{ group: string, name: string, ratio: number, minRatio: number, fg: string, bg: string }> }}
 */
export function validateChatTheme (themeObject, options = {}) {
  const tokenMap = { ...options.tokenMap }
  const failures = []
  const groups = {}

  // Standardize background & luminance
  const bgColor = themeObject.bgColor || themeObject.bg || '#FFFFFF'
  const rgbBg = compositeColor(bgColor, '#FFFFFF', tokenMap)
  const bgLuminance = getRelativeLuminance(rgbBg[0], rgbBg[1], rgbBg[2])
  const isDark = bgLuminance < 0.5

  // Flexible resolution of generic tokens with fallbacks for legacy custom themes
  const textPrimary = themeObject.textPrimary || themeObject['text-primary'] || themeObject['--atoll-chat-text-primary'] || (isDark ? '#FFFFFF' : '#111111')
  const textSecondary = themeObject.textSecondary || themeObject['text-secondary'] || themeObject['--atoll-chat-text-secondary'] || (isDark ? '#B0B0B0' : '#525252')
  const textMuted = themeObject.textMuted || themeObject['text-muted'] || themeObject['--atoll-chat-text-muted'] || (isDark ? '#949494' : '#767676')
  const accent = themeObject.accent || themeObject.accentColor || themeObject['accent-color'] || themeObject['--atoll-chat-accent'] || themeObject.sentBg || themeObject['bubble-sent-bg'] || (isDark ? '#06C755' : '#047835')
  const glassColor = themeObject.surfaceGlass || themeObject['surface-glass'] || themeObject.glassyFill || themeObject['--atoll-chat-surface-glass'] || themeObject.inputContainerBgCustom || (isDark ? 'rgba(31, 31, 31, 0.8)' : 'rgba(255, 255, 255, 0.8)')
  const border = themeObject.border || themeObject.borderTranslucent || themeObject['border-translucent'] || themeObject['--atoll-chat-border'] || themeObject.attachmentCardBorder || themeObject['attachment-card-border'] || (isDark ? '#888888' : '#767676')

  const glassyFill = compositeColor(glassColor, rgbBg, tokenMap)

  // Sent bubble
  const sentBg = themeObject.sentBg || themeObject['bubble-sent-bg'] || accent
  const solidSentBg = compositeColor(sentBg, rgbBg, tokenMap)
  const sentText = themeObject.sentColor || themeObject['bubble-sent-color'] || '#FFFFFF'
  const sentLink = themeObject.sentLinkColor || themeObject['bubble-sent-link-color'] || themeObject['bubble-sent-link-color-custom'] || sentText
  const sentTime = themeObject.sentTimestampColor || themeObject['bubble-sent-timestamp-color'] || sentText

  // Received bubble
  const receivedBg = themeObject.receivedBg || themeObject['bubble-received-bg'] || (isDark ? '#2A2A2A' : '#F5F5F5')
  const solidReceivedBg = compositeColor(receivedBg, rgbBg, tokenMap)
  const receivedText = themeObject.receivedColor || themeObject['bubble-received-color'] || (isDark ? '#FFFFFF' : '#111111')
  const receivedLink = themeObject.receivedLinkColor || themeObject['bubble-received-link-color'] || accent
  const receivedTime = themeObject.receivedTimestampColor || themeObject['bubble-received-timestamp-color'] || textSecondary

  // Attachment card bg
  const attachmentCardBg = themeObject.attachmentCardBg || themeObject['attachment-card-bg'] || (isDark ? '#6E6E6E' : '#767676')
  const solidAttachmentCardBg = compositeColor(attachmentCardBg, glassyFill, tokenMap)

  // Waveforms
  const waveformActive = themeObject.waveformActive || themeObject['waveform-active'] || (isDark ? '#00FF66' : '#FFFFFF')
  const waveformInactive = themeObject.waveformInactive || themeObject['waveform-inactive'] || (isDark ? '#FFFFFF' : '#111111')

  // Input & Buttons
  const btnSendBg = themeObject.btnSendBg || themeObject['btn-send-bg'] || accent
  const solidBtnSendBg = compositeColor(btnSendBg, glassyFill, tokenMap)
  const btnSendColor = themeObject.btnSendColor || themeObject['btn-send-color'] || '#FFFFFF'

  const inputBg = themeObject.inputBg || themeObject['input-bg'] || (isDark ? '#2A2A2A' : '#F5F5F5')
  const solidInputBg = compositeColor(inputBg, glassyFill, tokenMap)
  const inputColor = themeObject.inputColor || themeObject['input-color'] || textPrimary
  const inputPlaceholder = themeObject.inputPlaceholderColor || themeObject['input-placeholder-color'] || textSecondary
  const inputEmoji = themeObject.inputEmojiColor || themeObject['input-emoji-color'] || textSecondary

  // Check Helper
  const check = (groupName, checkName, fg, bg, minRatio) => {
    if (!groups[groupName]) {
      groups[groupName] = {
        pass: true,
        checks: []
      }
    }
    const fgRgb = typeof fg === 'string' ? compositeColor(fg, bg, tokenMap) : fg
    const bgRgb = typeof bg === 'string' ? compositeColor(bg, rgbBg, tokenMap) : bg

    const ratio = getContrastRatio(fgRgb, bgRgb)
    const pass = ratio >= minRatio

    const checkDetail = {
      name: checkName,
      ratio: Math.round(ratio * 100) / 100,
      minRatio,
      pass,
      fg: rgbToHex(fgRgb[0], fgRgb[1], fgRgb[2]),
      bg: rgbToHex(bgRgb[0], bgRgb[1], bgRgb[2])
    }

    groups[groupName].checks.push(checkDetail)
    if (!pass) {
      groups[groupName].pass = false
      failures.push({
        group: groupName,
        ...checkDetail
      })
    }
  }

  // Sent Bubble Group (min 4.5:1)
  check('Sent Bubble', 'Text vs Sent BG', sentText, solidSentBg, 4.5)
  check('Sent Bubble', 'Link vs Sent BG', sentLink, solidSentBg, 4.5)
  check('Sent Bubble', 'Timestamp vs Sent BG', sentTime, solidSentBg, 4.5)

  // Received Bubble Group (min 4.5:1)
  check('Received Bubble', 'Text vs Received BG', receivedText, solidReceivedBg, 4.5)
  check('Received Bubble', 'Accent Link vs Received BG', receivedLink, solidReceivedBg, 4.5)
  check('Received Bubble', 'Timestamp vs Received BG', receivedTime, solidReceivedBg, 4.5)

  // Generic Tokens Group (min 4.5:1)
  check('Generic Tokens', 'Primary Text vs Canvas BG', textPrimary, rgbBg, 4.5)
  check('Generic Tokens', 'Primary Text vs Glassy Fill', textPrimary, glassyFill, 4.5)
  check('Generic Tokens', 'Secondary Text vs Canvas BG', textSecondary, rgbBg, 4.5)
  check('Generic Tokens', 'Secondary Text vs Glassy Fill', textSecondary, glassyFill, 4.5)
  check('Generic Tokens', 'Muted Text vs Canvas BG', textMuted, rgbBg, 4.5)
  check('Generic Tokens', 'Muted Text vs Glassy Fill', textMuted, glassyFill, 4.5)

  // Input Container Group (min 4.5:1)
  check('Input Container', 'Input Text vs Input BG', inputColor, solidInputBg, 4.5)
  check('Input Container', 'Input Placeholder vs Input BG', inputPlaceholder, solidInputBg, 4.5)
  check('Input Container', 'Emoji Icon vs Input BG', inputEmoji, solidInputBg, 4.5)
  check('Input Container', 'Send Btn Icon vs Send Btn BG', btnSendColor, solidBtnSendBg, 4.5)

  // Graphical UI Group (min 3.0:1)
  check('Graphical UI', 'Waveform Active vs Card BG', waveformActive, solidAttachmentCardBg, 3.0)
  check('Graphical UI', 'Waveform Inactive vs Card BG', waveformInactive, solidAttachmentCardBg, 3.0)
  check('Graphical UI', 'Attachment Card BG vs Glassy Fill', solidAttachmentCardBg, glassyFill, 3.0)
  check('Graphical UI', 'Border vs Glassy Fill', border, glassyFill, 3.0)
  check('Graphical UI', 'Send Btn BG vs Glassy Fill', solidBtnSendBg, glassyFill, 3.0)

  const overallPass = failures.length === 0

  return {
    pass: overallPass,
    groups,
    failures
  }
}
