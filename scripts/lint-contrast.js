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

// Predefined theme definitions
const predefinedThemes = [
  {
    name: 'Classic (Light)',
    theme: {
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
    }
  },
  {
    name: 'Classic Dark',
    theme: {
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
  },
  {
    name: 'Ocean Gradient',
    theme: {
      bg: '#0f2027',
      glassyFill: 'rgba(15, 32, 39, 0.75)',
      'bubble-sent-bg': '#007299',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#1B3B48',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#00d2ff',
      'bubble-received-timestamp-color': 'rgba(255, 255, 255, 0.7)',
      'header-color': '#FFFFFF',
      'header-subtitle-color': 'rgba(255, 255, 255, 0.85)',
      'sender-name-color': 'rgba(255, 255, 255, 0.8)',
      'sent-status-color': 'rgba(255, 255, 255, 0.85)',
      'date-separator-color': '#FFFFFF',
      'date-separator-border': '#7095A8',
      'reaction-pill-color': '#FFFFFF',
      'reaction-pill-border': '#7095A8',
      'btn-attach-color': '#FFFFFF',
      'btn-voice-color': '#FFFFFF',
      'btn-send-bg': '#007299',
      'btn-send-color': '#FFFFFF',
      'input-bg': 'rgba(255, 255, 255, 0.12)',
      'input-color': '#FFFFFF',
      'input-placeholder-color': 'rgba(255, 255, 255, 0.65)',
      'input-emoji-color': 'rgba(255, 255, 255, 0.65)',
      'waveform-active': '#FFFFFF',
      'waveform-inactive': '#FFFFFF',
      'attachment-card-bg': '#387B91',
      'attachment-card-border': '#7095A8'
    }
  },
  {
    name: 'Forest Gradient',
    theme: {
      bg: '#11998e',
      glassyFill: 'rgba(10, 45, 35, 0.70)',
      'bubble-sent-bg': '#0B6B5F',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#08261E',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#38ef7d',
      'bubble-received-timestamp-color': 'rgba(255, 255, 255, 0.7)',
      'header-color': '#FFFFFF',
      'header-subtitle-color': 'rgba(255, 255, 255, 0.85)',
      'sender-name-color': '#111111',
      'sent-status-color': '#111111',
      'date-separator-color': '#FFFFFF',
      'date-separator-border': '#52A398',
      'reaction-pill-color': '#FFFFFF',
      'reaction-pill-border': '#52A398',
      'btn-attach-color': '#FFFFFF',
      'btn-voice-color': '#FFFFFF',
      'btn-send-bg': '#0B6B5F',
      'btn-send-color': '#FFFFFF',
      'input-bg': 'rgba(255, 255, 255, 0.18)',
      'input-color': '#FFFFFF',
      'input-placeholder-color': '#FFFFFF',
      'input-emoji-color': '#FFFFFF',
      'waveform-active': '#000000',
      'waveform-inactive': '#000000',
      'attachment-card-bg': '#3DA99B',
      'attachment-card-border': '#52A398'
    }
  },
  {
    name: 'Sunset Gradient',
    theme: {
      bg: '#f12711',
      glassyFill: 'rgba(40, 10, 15, 0.65)',
      'bubble-sent-bg': '#C91700',
      'bubble-sent-color': '#FFFFFF',
      'bubble-sent-link-color': '#FFFFFF',
      'bubble-sent-timestamp-color': '#FFFFFF',
      'bubble-received-bg': '#2D0C10',
      'bubble-received-color': '#FFFFFF',
      'bubble-received-link-color': '#f5af19',
      'bubble-received-timestamp-color': 'rgba(255, 255, 255, 0.7)',
      'header-color': '#FFFFFF',
      'header-subtitle-color': 'rgba(255, 255, 255, 0.85)',
      'sender-name-color': '#111111',
      'sent-status-color': '#111111',
      'date-separator-color': '#FFFFFF',
      'date-separator-border': '#C96B63',
      'reaction-pill-color': '#FFFFFF',
      'reaction-pill-border': '#C96B63',
      'btn-attach-color': '#FFFFFF',
      'btn-voice-color': '#FFFFFF',
      'btn-send-bg': '#C91700',
      'btn-send-color': '#FFFFFF',
      'input-bg': 'rgba(255, 255, 255, 0.14)',
      'input-color': '#FFFFFF',
      'input-placeholder-color': 'rgba(255, 255, 255, 0.65)',
      'input-emoji-color': 'rgba(255, 255, 255, 0.65)',
      'waveform-active': '#C91700',
      'waveform-inactive': '#111111',
      'attachment-card-bg': '#FFFFFF',
      'attachment-card-border': '#C96B63'
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

function generateNormalizedCustomTheme (p) {
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

  return {
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
      console.log(`  ✓ \x1b[32mPASS\x1b[0m  ${target.name.padEnd(28)} (${themeCheckCount} checks compliant)`)
    } else {
      totalFailures += result.failures.length
      console.log(`  ✗ \x1b[31mFAIL\x1b[0m  ${target.name.padEnd(28)} (${result.failures.length} failures)`)
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
