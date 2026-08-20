import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseColorToRgb,
  compositeColor,
  validateChatTheme
} from '../../src/utils/chat-theme-contrast.js'
import {
  ensureWCAGContrast,
  ensureForegroundContrast,
  getRelativeLuminance,
  rgbToHex
} from '../../src/utils/color-contrast.js'

test('parseColorToRgb parses various color formats correctly', () => {
  assert.deepEqual(parseColorToRgb('#fff'), [255, 255, 255, 1])
  assert.deepEqual(parseColorToRgb('#000000'), [0, 0, 0, 1])
  assert.deepEqual(parseColorToRgb('#ff0000ff'), [255, 0, 0, 1])
  assert.deepEqual(parseColorToRgb('#00ff0080'), [0, 255, 0, 0.5019607843137255])

  assert.deepEqual(parseColorToRgb('rgb(255, 255, 255)'), [255, 255, 255, 1])
  assert.deepEqual(parseColorToRgb('rgba(0, 0, 0, 0.5)'), [0, 0, 0, 0.5])

  assert.deepEqual(parseColorToRgb('hsl(0, 100%, 50%)'), [255, 0, 0, 1])
  assert.deepEqual(parseColorToRgb('hsla(120, 100%, 50%, 0.5)'), [0, 255, 0, 0.5])

  assert.deepEqual(parseColorToRgb('transparent'), [0, 0, 0, 0])
  assert.deepEqual(parseColorToRgb('currentColor'), [0, 0, 0, 1])

  // Var resolution
  const tokenMap = { '--brand': '#06C755' }
  assert.deepEqual(parseColorToRgb('var(--brand)', tokenMap), [6, 199, 85, 1])
  assert.deepEqual(parseColorToRgb('var(--missing, #ff0000)', tokenMap), [255, 0, 0, 1])

  // Fallback on invalid
  assert.deepEqual(parseColorToRgb('invalid-color'), [0, 0, 0, 1])
})

test('compositeColor correctly alpha composites translucent over solid background', () => {
  // Opaque over anything returns fg
  assert.deepEqual(compositeColor('#FFFFFF', '#000000'), [255, 255, 255])

  // Transparent returns bg
  assert.deepEqual(compositeColor('transparent', '#112233'), [17, 34, 51])

  // 50% black over white
  assert.deepEqual(compositeColor('rgba(0, 0, 0, 0.5)', '#FFFFFF'), [128, 128, 128])

  // 75% white over black (#000000)
  assert.deepEqual(compositeColor('rgba(255, 255, 255, 0.75)', '#000000'), [191, 191, 191])
})

test('validateChatTheme passes for standard predefined themes', () => {
  const predefinedThemes = [
    {
      name: 'classic',
      bg: '#FFFFFF',
      'bubble-sent-bg': '#047835',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#F5F5F5',
      'bubble-received-color': '#111111',
      'bubble-received-link-color': '#047835',
      'bubble-received-timestamp-color': '#595959',
      'header-color': '#111111',
      'header-subtitle-color': '#595959',
      'sender-name-color': '#595959',
      'sent-status-color': '#595959',
      'date-separator-color': '#4A4A4A',
      'date-separator-border': '#767676',
      'reaction-pill-color': '#4A4A4A',
      'reaction-pill-border': '#767676',
      'btn-attach-color': '#595959',
      'btn-voice-color': '#595959',
      'btn-send-bg': '#047835',
      'btn-send-color': '#FFFFFF',
      'input-bg': '#F5F5F5',
      'input-color': '#111111',
      'input-placeholder-color': '#595959',
      'input-emoji-color': '#595959',
      'waveform-active': '#FFFFFF',
      'waveform-inactive': '#111111',
      'attachment-card-bg': '#767676',
      'attachment-card-border': '#767676'
    },
    {
      name: 'classic-dark',
      bg: '#1F1F1F',
      'bubble-sent-bg': '#047835',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#2A2A2A',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#06C755',
      'bubble-received-timestamp-color': '#B0B0B0',
      'header-color': '#FFFFFF',
      'header-subtitle-color': '#B0B0B0',
      'sender-name-color': '#B0B0B0',
      'sent-status-color': '#CCCCCC',
      'date-separator-color': '#E0E0E0',
      'date-separator-border': '#888888',
      'reaction-pill-color': '#E0E0E0',
      'reaction-pill-border': '#888888',
      'btn-attach-color': '#B0B0B0',
      'btn-voice-color': '#B0B0B0',
      'btn-send-bg': '#047835',
      'btn-send-color': '#FFFFFF',
      'input-bg': '#2A2A2A',
      'input-color': '#FFFFFF',
      'input-placeholder-color': '#B0B0B0',
      'input-emoji-color': '#B0B0B0',
      'waveform-active': '#00FF66',
      'waveform-inactive': '#FFFFFF',
      'attachment-card-bg': '#6E6E6E',
      'attachment-card-border': '#888888'
    }
  ]

  for (const theme of predefinedThemes) {
    const res = validateChatTheme(theme)
    assert.equal(res.pass, true, `Theme ${theme.name} failed validation: ${JSON.stringify(res.failures)}`)
  }
})

test('validateChatTheme validates dynamically normalized custom themes', () => {
  const customPalettes = [
    { name: 'Light Pastel', bg: '#FAF0E6', sent: '#2E8B57', recv: '#F0E68C' },
    { name: 'Dark Navy', bg: '#0A192F', sent: '#1E90FF', recv: '#112240' },
    { name: 'Vibrant Orange/Purple', bg: '#1A0B2E', sent: '#FF4500', recv: '#301934' },
    { name: 'Muted Slate', bg: '#2F3E46', sent: '#52B788', recv: '#354F52' }
  ]

  for (const p of customPalettes) {
    const rgbBg = compositeColor(p.bg, '#FFFFFF')
    const rgbBgHex = rgbToHex(rgbBg[0], rgbBg[1], rgbBg[2])
    const bgLuminance = getRelativeLuminance(rgbBg[0], rgbBg[1], rgbBg[2])

    const glassyBgHex = bgLuminance < 0.5 ? 'rgba(31, 31, 31, 0.75)' : 'rgba(255, 255, 255, 0.75)'
    const glassyFill = compositeColor(glassyBgHex, rgbBg)
    const glassyFillHex = rgbToHex(glassyFill[0], glassyFill[1], glassyFill[2])

    const compSent = ensureWCAGContrast(p.sent, 4.5)
    const sentBg = compSent.bgHex
    const sentColor = compSent.textColor

    const compRecv = ensureWCAGContrast(p.recv, 4.5)
    const recvBg = compRecv.bgHex
    const recvColor = compRecv.textColor

    const baseCanvasText = bgLuminance < 0.5 ? '#FFFFFF' : '#111111'
    const inputBg = bgLuminance < 0.5 ? '#2A2A2A' : '#F5F5F5'
    const solidInputBg = compositeColor(inputBg, glassyFill)
    const solidInputBgHex = rgbToHex(solidInputBg[0], solidInputBg[1], solidInputBg[2])

    const rawCardBg = bgLuminance < 0.5 ? '#484848' : '#767676'
    const solidCardBgHex = ensureForegroundContrast(rawCardBg, glassyFillHex, 3.0)

    const defaultBorder = bgLuminance < 0.5 ? '#888888' : '#767676'

    const themeObj = {
      bgColor: p.bg,
      sentBg,
      sentColor,
      sentLinkColor: ensureForegroundContrast(sentColor, sentBg, 4.5),
      sentTimestampColor: ensureForegroundContrast(sentColor, sentBg, 4.5),
      receivedBg: recvBg,
      receivedColor: recvColor,
      receivedLinkColor: ensureForegroundContrast(sentBg, recvBg, 4.5),
      receivedTimestampColor: ensureForegroundContrast(recvColor, recvBg, 4.5),
      senderNameColor: ensureForegroundContrast(baseCanvasText, rgbBgHex, 4.5),
      sentStatusColor: ensureForegroundContrast(baseCanvasText, rgbBgHex, 4.5),
      headerColor: ensureForegroundContrast(baseCanvasText, glassyFillHex, 4.5),
      headerSubtitleColor: ensureForegroundContrast(baseCanvasText, glassyFillHex, 4.5),
      btnAttachColor: ensureForegroundContrast(baseCanvasText, glassyFillHex, 4.5),
      btnVoiceColor: ensureForegroundContrast(baseCanvasText, glassyFillHex, 4.5),
      btnSendBg: sentBg,
      btnSendColor: sentColor,
      inputBg,
      inputColor: ensureForegroundContrast(baseCanvasText, solidInputBgHex, 4.5),
      inputPlaceholderColor: ensureForegroundContrast(bgLuminance < 0.5 ? '#B0B0B0' : '#595959', solidInputBgHex, 4.5),
      inputEmojiColor: ensureForegroundContrast(bgLuminance < 0.5 ? '#B0B0B0' : '#595959', solidInputBgHex, 4.5),
      dateSeparatorColor: ensureForegroundContrast(baseCanvasText, glassyFillHex, 4.5),
      dateSeparatorBorder: ensureForegroundContrast(defaultBorder, glassyFillHex, 3.0),
      reactionPillColor: ensureForegroundContrast(baseCanvasText, glassyFillHex, 4.5),
      reactionPillBorder: ensureForegroundContrast(defaultBorder, glassyFillHex, 3.0),
      waveformActive: ensureForegroundContrast(sentBg, solidCardBgHex, 3.0),
      waveformInactive: ensureForegroundContrast(bgLuminance < 0.5 ? '#A0A0A0' : '#4A4A4A', solidCardBgHex, 3.0),
      attachmentCardBg: solidCardBgHex,
      attachmentCardBorder: ensureForegroundContrast(defaultBorder, glassyFillHex, 3.0)
    }

    const res = validateChatTheme(themeObj)
    assert.equal(res.pass, true, `Palette ${p.name} failed validation: ${JSON.stringify(res.failures)}`)
  }
})

test('validateChatTheme handles malformed input gracefully', () => {
  const badTheme = {
    bgColor: 'invalid',
    sentBg: null,
    receivedBg: undefined
  }

  const res = validateChatTheme(badTheme)
  assert.equal(typeof res.pass, 'boolean')
  assert.equal(Array.isArray(res.failures), true)
})
