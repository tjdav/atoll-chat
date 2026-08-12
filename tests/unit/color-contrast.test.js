import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  getRelativeLuminance,
  getContrastRatio,
  ensureWCAGContrast,
  ensureForegroundContrast,
  generateImagePalettes,
  getAverageColor
} from '../../src/utils/color-contrast.js'

describe('Color Contrast and Conversion Utility', () => {
  test('hexToRgb & rgbToHex conversions', () => {
    assert.deepEqual(hexToRgb('#FFFFFF'), [255, 255, 255])
    assert.deepEqual(hexToRgb('#000000'), [0, 0, 0])
    assert.deepEqual(hexToRgb('#FF5733'), [255, 87, 51])
    assert.deepEqual(hexToRgb('#ABC'), [170, 187, 204])

    assert.equal(rgbToHex(255, 255, 255), '#FFFFFF')
    assert.equal(rgbToHex(0, 0, 0), '#000000')
    assert.equal(rgbToHex(255, 87, 51), '#FF5733')
  })

  test('rgbToHsl & hslToRgb conversions', () => {
    // White
    assert.deepEqual(rgbToHsl(255, 255, 255), [0, 0, 100])
    assert.deepEqual(hslToRgb(0, 0, 100), [255, 255, 255])

    // Black
    assert.deepEqual(rgbToHsl(0, 0, 0), [0, 0, 0])
    assert.deepEqual(hslToRgb(0, 0, 0), [0, 0, 0])

    // Red
    assert.deepEqual(rgbToHsl(255, 0, 0), [0, 100, 50])
    assert.deepEqual(hslToRgb(0, 100, 50), [255, 0, 0])
  })

  test('getRelativeLuminance calculation', () => {
    // Relative luminance of pure white should be 1
    assert.equal(getRelativeLuminance(255, 255, 255), 1)
    // Relative luminance of pure black should be 0
    assert.equal(getRelativeLuminance(0, 0, 0), 0)
  })

  test('getContrastRatio calculation against WCAG standards', () => {
    // White and Black ratio should be 21:1
    assert.equal(Math.round(getContrastRatio('#FFFFFF', '#000000')), 21)

    // White against itself should be 1:1
    assert.equal(getContrastRatio('#FFFFFF', '#FFFFFF'), 1)
  })

  test('ensureWCAGContrast lightness adjustments', () => {
    // Ensure we can make it compliant with white or dark text
    const result = ensureWCAGContrast('#06C755', 4.5)

    assert.ok(result.ratio >= 4.5, `Adjusted ratio (${result.ratio}) must be at least 4.5`)
    assert.ok(result.textColor === '#FFFFFF' || result.textColor === '#111111')
    assert.equal(typeof result.bgHex, 'string')
    assert.match(result.bgHex, /^#[0-9A-F]{6}$/i)
  })

  test('ensureForegroundContrast text lightness adjustments against background', () => {
    // On dark background (#111111), low-contrast green (#113311) as text should be lightened
    const lightenedText = ensureForegroundContrast('#113311', '#111111', 4.5)
    assert.ok(getContrastRatio(lightenedText, '#111111') >= 4.5)

    // On light background (#FFFFFF), low-contrast light text (#EEEEEE) should be darkened
    const darkenedText = ensureForegroundContrast('#EEEEEE', '#FFFFFF', 4.5)
    assert.ok(getContrastRatio(darkenedText, '#FFFFFF') >= 4.5)
  })

  test('generateImagePalettes falls back gracefully if canvas has no image data', () => {
    // Pass null/empty or invalid input, should return fallback palette
    const vibrant = generateImagePalettes(null, 'vibrant')
    assert.ok(Array.isArray(vibrant))
    assert.ok(vibrant.length >= 6 && vibrant.length <= 8)
    vibrant.forEach(color => assert.match(color, /^#[0-9A-F]{6}$/i))

    const muted = generateImagePalettes(null, 'muted')
    assert.ok(Array.isArray(muted))

    const pastel = generateImagePalettes(null, 'pastel')
    assert.ok(Array.isArray(pastel))

    const deep = generateImagePalettes(null, 'deep')
    assert.ok(Array.isArray(deep))
  })

  test('getAverageColor falls back gracefully if canvas has no image data', () => {
    // Pass null/empty or invalid input, should return white fallback
    const avgColor = getAverageColor(null)
    assert.equal(avgColor, '#FFFFFF')
  })
})
