#!/usr/bin/env node

/**
 * CLI script to audit WCAG 2.2 AA contrast compliance across all predefined
 * and dynamically generated custom chat themes.
 */

import { validateChatTheme } from '../src/utils/chat-theme-contrast.js'
import {
  ensureWCAGContrast,
  ensureForegroundContrast,
  getRelativeLuminance,
  compositeColor,
  rgbToHex
} from '../src/utils/color-contrast.js'

// Predefined theme definitions supplying generic tokens
const predefinedThemes = [
  {
    name: 'Classic (Light)',
    theme: {
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
      'header-btn-bg': 'rgba(0, 0, 0, 0.08)',
      'header-btn-color': '#111111',
      'waveform-active': '#FFFFFF',
      'waveform-inactive': '#111111',
      'attachment-card-bg': '#767676'
    }
  },
  {
    name: 'Classic Dark',
    theme: {
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
      'header-btn-bg': 'rgba(255, 255, 255, 0.18)',
      'header-btn-color': '#FFFFFF',
      'waveform-active': '#00FF66',
      'waveform-inactive': '#FFFFFF',
      'attachment-card-bg': '#6E6E6E'
    }
  },
  {
    name: 'Ocean Gradient',
    theme: {
      bg: '#0f2027',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(255, 255, 255, 0.85)',
      textMuted: 'rgba(255, 255, 255, 0.7)',
      accent: '#00d2ff',
      surfaceGlass: 'rgba(15, 32, 39, 0.75)',
      border: '#7095A8',
      'bubble-sent-bg': '#007299',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#1B3B48',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#00d2ff',
      'bubble-received-timestamp-color': 'rgba(255, 255, 255, 0.7)',
      'btn-send-bg': '#007299',
      'btn-send-color': '#FFFFFF',
      'input-bg': 'rgba(255, 255, 255, 0.12)',
      'input-color': '#FFFFFF',
      'input-placeholder-color': 'rgba(255, 255, 255, 0.75)',
      'input-emoji-color': 'rgba(255, 255, 255, 0.75)',
      'header-btn-bg': 'rgba(255, 255, 255, 0.18)',
      'header-btn-color': '#FFFFFF',
      'waveform-active': '#FFFFFF',
      'waveform-inactive': '#FFFFFF',
      'attachment-card-bg': '#387B91'
    }
  },
  {
    name: 'Forest Gradient',
    theme: {
      bg: '#0A2D23',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(255, 255, 255, 0.85)',
      textMuted: 'rgba(255, 255, 255, 0.75)',
      accent: '#38ef7d',
      surfaceGlass: 'rgba(10, 45, 35, 0.70)',
      border: '#52A398',
      'bubble-sent-bg': '#0B6B5F',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#08261E',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#38ef7d',
      'bubble-received-timestamp-color': 'rgba(255, 255, 255, 0.7)',
      'btn-send-bg': '#05883C',
      'btn-send-color': '#FFFFFF',
      'input-bg': 'rgba(255, 255, 255, 0.18)',
      'input-color': '#FFFFFF',
      'input-placeholder-color': '#FFFFFF',
      'input-emoji-color': '#FFFFFF',
      'header-btn-bg': 'rgba(255, 255, 255, 0.18)',
      'header-btn-color': '#FFFFFF',
      'waveform-active': '#38ef7d',
      'waveform-inactive': '#FFFFFF',
      'attachment-card-bg': '#707070'
    }
  },
  {
    name: 'Sunset Gradient',
    theme: {
      bg: '#2D0C10',
      textPrimary: '#FFFFFF',
      textSecondary: 'rgba(255, 255, 255, 0.85)',
      textMuted: 'rgba(255, 255, 255, 0.75)',
      accent: '#f5af19',
      surfaceGlass: 'rgba(40, 10, 15, 0.65)',
      border: '#C96B63',
      'bubble-sent-bg': '#C91700',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#2D0C10',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#f5af19',
      'bubble-received-timestamp-color': 'rgba(255, 255, 255, 0.7)',
      'btn-send-bg': '#C91700',
      'btn-send-color': '#FFFFFF',
      'input-bg': 'rgba(255, 255, 255, 0.14)',
      'input-color': '#FFFFFF',
      'input-placeholder-color': 'rgba(255, 255, 255, 0.75)',
      'input-emoji-color': 'rgba(255, 255, 255, 0.75)',
      'header-btn-bg': 'rgba(255, 255, 255, 0.18)',
      'header-btn-color': '#FFFFFF',
      'waveform-active': '#FFD54F',
      'waveform-inactive': '#FFFFFF',
      'attachment-card-bg': '#6E6E6E'
    }
  }
]

// Custom theme samples across palette modes & canvas lightness
const sampleCustomPalettes = [
  {
    name: 'Custom Pastel (Light)',
    bg: '#FFF5EE',
    sent: '#4682B4',
    recv: '#E6E6FA'
  },
  {
    name: 'Custom Vibrant (Light)',
    bg: '#FFFFFF',
    sent: '#FF1493',
    recv: '#E0FFFF'
  },
  {
    name: 'Custom Deep (Dark)',
    bg: '#0D1117',
    sent: '#005A9C',
    recv: '#161B22'
  },
  {
    name: 'Custom Muted (Dark)',
    bg: '#181818',
    sent: '#2B5B84',
    recv: '#212121'
  },
  {
    name: 'Custom Mid-tone Green',
    bg: '#2D5A27',
    sent: '#00A86B',
    recv: '#1E3A1A'
  }
]

// Test palette fixtures simulating legacy custom themes (missing generic keys/sender name/timestamp keys)
const legacyCustomThemes = [
  {
    name: 'Legacy Custom Light (Fallback Path)',
    theme: {
      bg: '#FFFFFF',
      'bubble-sent-bg': '#047835',
      'bubble-sent-color': '#FFFFFF',
      'bubble-received-bg': '#F5F5F5',
      'bubble-received-color': '#111111'
    }
  },
  {
    name: 'Legacy Custom Dark (Fallback Path)',
    theme: {
      bg: '#121212',
      'bubble-sent-bg': '#007299',
      'bubble-sent-color': '#FFFFFF',
      'bubble-received-bg': '#222222',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#06C755'
    }
  }
]

function generateNormalizedCustomTheme (p) {
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

  const headerBtnBg = isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.08)'
  const headerBtnColor = ensureForegroundContrast(baseCanvasText, compositeColor(headerBtnBg, glassyFill), 4.5)

  return {
    headerBtnBg,
    headerBtnColor,
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
}

function runAudit () {
  console.log('====================================================')
  console.log('  WCAG 2.2 AA Chat Theme Color-Contrast Audit')
  console.log('====================================================\n')

  let totalThemes = 0
  let totalChecks = 0
  let totalFailures = 0

  const allTargets = [
    ...predefinedThemes.map(t => ({
      name: t.name,
      themeObj: t.theme
    })),
    ...sampleCustomPalettes.map(p => ({
      name: p.name,
      themeObj: generateNormalizedCustomTheme(p)
    })),
    ...legacyCustomThemes.map(t => ({
      name: t.name,
      themeObj: t.theme
    }))
  ]

  for (const target of allTargets) {
    totalThemes++
    const result = validateChatTheme(target.themeObj)

    let themeCheckCount = 0
    for (const group of Object.values(result.groups)) {
      themeCheckCount += group.checks.length
    }
    totalChecks += themeCheckCount

    if (result.pass) {
      console.log(`  ✓ \x1b[32mPASS\x1b[0m  ${target.name.padEnd(42)} (${themeCheckCount} checks compliant)`)
    } else {
      totalFailures += result.failures.length
      console.log(`  ✗ \x1b[31mFAIL\x1b[0m  ${target.name.padEnd(42)} (${result.failures.length} failures)`)
      for (const fail of result.failures) {
        console.log(`      - [${fail.group}] ${fail.name}: ratio ${fail.ratio}:1 (required >= ${fail.minRatio}:1) [fg: ${fail.fg}, bg: ${fail.bg}]`)
      }
    }
  }

  console.log('\n----------------------------------------------------')
  console.log(`Summary: ${totalThemes} themes audited, ${totalChecks} total pairings checked.`)
  if (totalFailures === 0) {
    console.log('\x1b[32mResult: 100% WCAG 2.2 AA Compliance achieved!\x1b[0m\n')
    process.exit(0)
  } else {
    console.log(`\x1b[31mResult: ${totalFailures} contrast checks failed.\x1b[0m\n`)
    process.exit(1)
  }
}

runAudit()
