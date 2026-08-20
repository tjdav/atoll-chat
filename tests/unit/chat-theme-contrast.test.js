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

test('validateChatTheme passes for standard predefined themes with generic tokens', () => {
  const predefinedThemes = [
    {
      name: 'classic',
      bg: '#FFFFFF',
      textPrimary: '#111111',
      textSecondary: '#525252',
      textMuted: '#767676',
      accent: '#047835',
      surfaceGlass: 'rgba(255, 255, 255, 0.8)',
      border: '#767676',
      'bubble-sent-bg': '#047835',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#F5F5F5',
      'bubble-received-color': '#111111',
      'bubble-received-link-color': '#047835',
      'bubble-received-timestamp-color': '#525252',
      'btn-send-bg': '#047835',
      'btn-send-color': '#FFFFFF',
      'input-bg': '#F5F5F5',
      'input-color': '#111111',
      'input-placeholder-color': '#525252',
      'input-emoji-color': '#525252',
      'waveform-active': '#FFFFFF',
      'waveform-inactive': '#111111',
      'attachment-card-bg': '#767676'
    },
    {
      name: 'classic-dark',
      bg: '#1F1F1F',
      textPrimary: '#FFFFFF',
      textSecondary: '#B0B0B0',
      textMuted: '#949494',
      accent: '#06C755',
      surfaceGlass: 'rgba(31, 31, 31, 0.8)',
      border: '#888888',
      'bubble-sent-bg': '#047835',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#2A2A2A',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#06C755',
      'bubble-received-timestamp-color': '#B0B0B0',
      'btn-send-bg': '#05883C',
      'btn-send-color': '#FFFFFF',
      'input-bg': '#2A2A2A',
      'input-color': '#FFFFFF',
      'input-placeholder-color': '#B0B0B0',
      'input-emoji-color': '#B0B0B0',
      'waveform-active': '#00FF66',
      'waveform-inactive': '#FFFFFF',
      'attachment-card-bg': '#6E6E6E'
    }
  ]

  for (const theme of predefinedThemes) {
    const res = validateChatTheme(theme)
    assert.equal(res.pass, true, `Theme ${theme.name} failed validation: ${JSON.stringify(res.failures)}`)
    assert.ok(res.groups['Generic Tokens'], 'Generic Tokens group should exist')
    assert.ok(res.groups['Graphical UI'], 'Graphical UI group should exist')
    assert.ok(res.groups['Sent Bubble'], 'Sent Bubble group should exist')
    assert.ok(res.groups['Received Bubble'], 'Received Bubble group should exist')
    assert.ok(res.groups['Input Container'], 'Input Container group should exist')
  }
})

test('validateChatTheme validates dynamically normalized custom themes with generic tokens', () => {
  const customPalettes = [
    {
      name: 'Light Pastel',
      bg: '#FAF0E6',
      sent: '#2E8B57',
      recv: '#F0E68C'
    },
    {
      name: 'Dark Navy',
      bg: '#0A192F',
      sent: '#1E90FF',
      recv: '#112240'
    },
    {
      name: 'Vibrant Orange/Purple',
      bg: '#1A0B2E',
      sent: '#FF4500',
      recv: '#301934'
    },
    {
      name: 'Muted Slate',
      bg: '#2F3E46',
      sent: '#52B788',
      recv: '#354F52'
    }
  ]

  for (const p of customPalettes) {
    const rgbBg = compositeColor(p.bg, '#FFFFFF')
    const rgbBgHex = rgbToHex(rgbBg[0], rgbBg[1], rgbBg[2])
    const bgLuminance = getRelativeLuminance(rgbBg[0], rgbBg[1], rgbBg[2])
    const isDark = bgLuminance < 0.5

    const glassyBgHex = isDark ? 'rgba(31, 31, 31, 0.8)' : 'rgba(255, 255, 255, 0.8)'
    const glassyFill = compositeColor(glassyBgHex, rgbBg)
    const glassyFillHex = rgbToHex(glassyFill[0], glassyFill[1], glassyFill[2])

    const compSent = ensureWCAGContrast(p.sent, 4.5)
    const sentBg = compSent.bgHex
    const sentColor = compSent.textColor

    const compRecv = ensureWCAGContrast(p.recv, 4.5)
    const recvBg = compRecv.bgHex
    const recvColor = compRecv.textColor

    const baseCanvasText = isDark ? '#FFFFFF' : '#111111'
    const inputBg = isDark ? '#2A2A2A' : '#F5F5F5'
    const solidInputBg = compositeColor(inputBg, glassyFill)
    const solidInputBgHex = rgbToHex(solidInputBg[0], solidInputBg[1], solidInputBg[2])

    const rawCardBg = isDark ? '#6E6E6E' : '#767676'
    const solidCardBgHex = ensureForegroundContrast(rawCardBg, glassyFillHex, 3.0)

    const rawBorder = isDark ? '#888888' : '#767676'
    const defaultBorder = ensureForegroundContrast(rawBorder, glassyFillHex, 3.0)

    const btnSendBg = ensureForegroundContrast(sentBg, glassyFillHex, 3.0)

    const themeObj = {
      bgColor: p.bg,
      textPrimary: ensureForegroundContrast(baseCanvasText, rgbBgHex, 4.5),
      textSecondary: ensureForegroundContrast(isDark ? '#B0B0B0' : '#525252', rgbBgHex, 4.5),
      textMuted: ensureForegroundContrast(isDark ? '#949494' : '#767676', rgbBgHex, 4.5),
      accent: sentBg,
      surfaceGlass: glassyBgHex,
      border: defaultBorder,
      sentBg,
      sentColor,
      sentLinkColor: ensureForegroundContrast(sentColor, sentBg, 4.5),
      sentTimestampColor: ensureForegroundContrast(sentColor, sentBg, 4.5),
      receivedBg: recvBg,
      receivedColor: recvColor,
      receivedLinkColor: ensureForegroundContrast(sentBg, recvBg, 4.5),
      receivedTimestampColor: ensureForegroundContrast(recvColor, recvBg, 4.5),
      btnSendBg,
      btnSendColor: sentColor,
      inputBg,
      inputColor: ensureForegroundContrast(baseCanvasText, solidInputBgHex, 4.5),
      inputPlaceholderColor: ensureForegroundContrast(isDark ? '#B0B0B0' : '#525252', solidInputBgHex, 4.5),
      inputEmojiColor: ensureForegroundContrast(isDark ? '#B0B0B0' : '#525252', solidInputBgHex, 4.5),
      waveformActive: ensureForegroundContrast(sentBg, solidCardBgHex, 3.0),
      waveformInactive: ensureForegroundContrast(isDark ? '#FFFFFF' : '#111111', solidCardBgHex, 3.0),
      attachmentCardBg: solidCardBgHex
    }

    const res = validateChatTheme(themeObj)
    assert.equal(res.pass, true, `Palette ${p.name} failed validation: ${JSON.stringify(res.failures)}`)
  }
})

test('validateChatTheme correctly derives fallbacks for legacy custom themes missing explicit generic tokens', () => {
  const legacyLight = {
    bg: '#FFFFFF',
    'bubble-sent-bg': '#047835',
    'bubble-sent-color': '#FFFFFF',
    'bubble-received-bg': '#F5F5F5',
    'bubble-received-color': '#111111'
  }

  const resLight = validateChatTheme(legacyLight)
  assert.equal(resLight.pass, true)
  assert.ok(resLight.groups['Generic Tokens'])

  const legacyDark = {
    bg: '#121212',
    'bubble-sent-bg': '#007299',
    'bubble-sent-color': '#FFFFFF',
    'bubble-received-bg': '#222222',
    'bubble-received-color': '#FFFFFF',
    'bubble-received-link-color': '#06C755'
  }

  const resDark = validateChatTheme(legacyDark)
  assert.equal(resDark.pass, true)
  assert.ok(resDark.groups['Generic Tokens'])
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
