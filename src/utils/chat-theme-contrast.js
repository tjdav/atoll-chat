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
  const fg = typeof fgColor === 'string' ? parseColorToRgb(fgColor, tokenMap) : fgColor
  const bg = typeof bgColor === 'string' ? parseColorToRgb(bgColor, tokenMap) : bgColor

  const alpha = fg[3]
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

  // Standardize theme properties
  const bgColor = themeObject.bgColor || themeObject.bg || '#FFFFFF'
  const rgbBg = compositeColor(bgColor, '#FFFFFF', tokenMap)
  const bgLuminance = getRelativeLuminance(rgbBg[0], rgbBg[1], rgbBg[2])

  // Glassy background selection: dark glass when bgLuminance < 0.5, light glass when >= 0.5
  const defaultGlass = bgLuminance < 0.5 ? 'rgba(31, 31, 31, 0.75)' : 'rgba(255, 255, 255, 0.75)'
  const glassColor = themeObject.inputContainerBgCustom || themeObject.glassyFill || defaultGlass
  const glassyFill = compositeColor(glassColor, rgbBg, tokenMap)

  // Sent bubble
  const sentBg = themeObject.sentBg || themeObject['bubble-sent-bg'] || '#06C755'
  const solidSentBg = compositeColor(sentBg, rgbBg, tokenMap)
  const sentText = themeObject.sentColor || themeObject['bubble-sent-color'] || '#FFFFFF'
  const sentLink = themeObject.sentLinkColor || themeObject['bubble-sent-link-color'] || themeObject['bubble-sent-link-color-custom'] || sentText
  const sentTime = themeObject.sentTimestampColor || themeObject['bubble-sent-timestamp-color'] || sentText

  // Received bubble
  const receivedBg = themeObject.receivedBg || themeObject['bubble-received-bg'] || '#EEEEEE'
  const solidReceivedBg = compositeColor(receivedBg, rgbBg, tokenMap)
  const receivedText = themeObject.receivedColor || themeObject['bubble-received-color'] || '#111111'
  const receivedLink = themeObject.receivedLinkColor || themeObject['bubble-received-link-color'] || themeObject['bubble-received-link-color-custom'] || receivedText
  const receivedTime = themeObject.receivedTimestampColor || themeObject['bubble-received-timestamp-color'] || receivedText

  // Attachment card bg
  const attachmentCardBg = themeObject.attachmentCardBg || themeObject['attachment-card-bg'] || solidReceivedBg
  const solidAttachmentCardBg = compositeColor(attachmentCardBg, glassyFill, tokenMap)

  // Waveforms
  const waveformActive = themeObject.waveformActive || themeObject['waveform-active'] || sentBg
  const waveformInactive = themeObject.waveformInactive || themeObject['waveform-inactive'] || 'rgba(6, 199, 85, 0.25)'

  // Header & Input bar
  const headerTitle = themeObject.headerColor || themeObject['header-color'] || (bgLuminance < 0.5 ? '#FFFFFF' : '#111111')
  const headerSubtitle = themeObject.headerSubtitleColor || themeObject['header-subtitle-color'] || themeObject.senderNameColor || headerTitle

  const btnAttachColor = themeObject.btnAttachColor || themeObject['btn-attach-color'] || headerTitle
  const btnVoiceColor = themeObject.btnVoiceColor || themeObject['btn-voice-color'] || headerTitle
  const btnSendBg = themeObject.btnSendBg || themeObject['btn-send-bg'] || sentBg
  const solidBtnSendBg = compositeColor(btnSendBg, glassyFill, tokenMap)
  const btnSendColor = themeObject.btnSendColor || themeObject['btn-send-color'] || '#FFFFFF'

  const inputBg = themeObject.inputBg || themeObject['input-bg'] || (bgLuminance < 0.5 ? '#2A2A2A' : '#F5F5F5')
  const solidInputBg = compositeColor(inputBg, glassyFill, tokenMap)
  const inputColor = themeObject.inputColor || themeObject['input-color'] || (bgLuminance < 0.5 ? '#FFFFFF' : '#111111')
  const inputPlaceholder = themeObject.inputPlaceholderColor || themeObject['input-placeholder-color'] || inputColor
  const inputEmoji = themeObject.inputEmojiColor || themeObject['input-emoji-color'] || inputColor

  // Canvas elements
  const senderName = themeObject.senderNameColor || themeObject['sender-name-color'] || (bgLuminance < 0.5 ? '#FFFFFF' : '#111111')
  const sentStatus = themeObject.sentStatusColor || themeObject['sent-status-color'] || (bgLuminance < 0.5 ? '#FFFFFF' : '#111111')

  // Pills and Separators
  const datePillText = themeObject.dateSeparatorColor || themeObject['date-separator-color'] || (bgLuminance < 0.5 ? '#FFFFFF' : '#111111')
  const rxnPillText = themeObject.reactionPillColor || themeObject['reaction-pill-color'] || (bgLuminance < 0.5 ? '#FFFFFF' : '#111111')

  const datePillBorder = themeObject.dateSeparatorBorder || themeObject['date-separator-border'] || 'rgba(0, 0, 0, 0.08)'
  const rxnPillBorder = themeObject.reactionPillBorder || themeObject['reaction-pill-border'] || 'rgba(0, 0, 0, 0.08)'
  const attachmentCardBorder = themeObject.attachmentCardBorder || themeObject['attachment-card-border'] || 'rgba(0, 0, 0, 0.08)'

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
  check('Received Bubble', 'Link vs Received BG', receivedLink, solidReceivedBg, 4.5)
  check('Received Bubble', 'Timestamp vs Received BG', receivedTime, solidReceivedBg, 4.5)

  // Glassy Header & Floating Glass (min 4.5:1)
  check('Glassy Glass', 'Header Title vs Glassy Fill', headerTitle, glassyFill, 4.5)
  check('Glassy Glass', 'Header Subtitle vs Glassy Fill', headerSubtitle, glassyFill, 4.5)
  check('Glassy Glass', 'Btn Attach Icon vs Glassy Fill', btnAttachColor, glassyFill, 4.5)
  check('Glassy Glass', 'Btn Voice Icon vs Glassy Fill', btnVoiceColor, glassyFill, 4.5)
  check('Glassy Glass', 'Date Pill Text vs Glassy Fill', datePillText, glassyFill, 4.5)
  check('Glassy Glass', 'Reaction Pill Text vs Glassy Fill', rxnPillText, glassyFill, 4.5)

  // Input Container (min 4.5:1)
  check('Input Container', 'Input Text vs Input BG', inputColor, solidInputBg, 4.5)
  check('Input Container', 'Input Placeholder vs Input BG', inputPlaceholder, solidInputBg, 4.5)
  check('Input Container', 'Emoji Icon vs Input BG', inputEmoji, solidInputBg, 4.5)
  check('Input Container', 'Send Btn Icon vs Send Btn BG', btnSendColor, solidBtnSendBg, 4.5)

  // Canvas Direct Elements (min 4.5:1)
  check('Canvas Elements', 'Sender Name vs Canvas BG', senderName, rgbBg, 4.5)
  check('Canvas Elements', 'Sent Status vs Canvas BG', sentStatus, rgbBg, 4.5)

  // Graphical / UI Elements (min 3.0:1)
  check('Graphical UI', 'Waveform Active vs Card BG', waveformActive, solidAttachmentCardBg, 3.0)
  check('Graphical UI', 'Waveform Inactive vs Card BG', waveformInactive, solidAttachmentCardBg, 3.0)
  check('Graphical UI', 'Attachment Card BG vs Canvas/Glass', solidAttachmentCardBg, glassyFill, 3.0)
  check('Graphical UI', 'Date Pill Border vs Canvas/Glass', datePillBorder, glassyFill, 3.0)
  check('Graphical UI', 'Reaction Pill Border vs Canvas/Glass', rxnPillBorder, glassyFill, 3.0)
  check('Graphical UI', 'Attachment Card Border vs Canvas/Glass', attachmentCardBorder, glassyFill, 3.0)

  const overallPass = failures.length === 0

  return {
    pass: overallPass,
    groups,
    failures
  }
}
