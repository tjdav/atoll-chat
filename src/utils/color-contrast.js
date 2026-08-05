/**
 * Utility functions for WCAG 2.2 contrast checking, color space conversions,
 * lightness adjustments, and image palette extraction.
 */

/**
 * Converts a hex string to an [R, G, B] array.
 * @param {string} hex
 * @returns {number[]}
 */
export function hexToRgb(hex) {
  let cleanHex = hex.replace(/^#/, '')
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('')
  }
  const num = parseInt(cleanHex, 16)
  return [
    (num >> 16) & 255,
    (num >> 8) & 255,
    num & 255
  ]
}

/**
 * Converts R, G, B values to a hex string.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  const clamp = (val) => Math.max(0, Math.min(255, Math.round(val)))
  const cr = clamp(r).toString(16).padStart(2, '0')
  const cg = clamp(g).toString(16).padStart(2, '0')
  const cb = clamp(b).toString(16).padStart(2, '0')
  return `#${cr}${cg}${cb}`.toUpperCase()
}

/**
 * Converts RGB to HSL.
 * @param {number} r (0-255)
 * @param {number} g (0-255)
 * @param {number} b (0-255)
 * @returns {number[]} [h (0-360), s (0-100), l (0-100)]
 */
export function rgbToHsl(r, g, b) {
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255
  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
        break
      case gNorm:
        h = (bNorm - rNorm) / d + 2
        break
      case bNorm:
        h = (rNorm - gNorm) / d + 4
        break
    }
    h /= 6
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/**
 * Converts HSL to RGB.
 * @param {number} h (0-360)
 * @param {number} s (0-100)
 * @param {number} l (0-100)
 * @returns {number[]} [r, g, b] (0-255)
 */
export function hslToRgb(h, s, l) {
  const hNorm = h / 360
  const sNorm = s / 100
  const lNorm = l / 100

  let r = lNorm
  let g = lNorm
  let b = lNorm

  if (sNorm !== 0) {
    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm
    const p = 2 * lNorm - q
    const hue2rgb = (t) => {
      let tNorm = t
      if (tNorm < 0) tNorm += 1
      if (tNorm > 1) tNorm -= 1
      if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm
      if (tNorm < 1 / 2) return q
      if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6
      return p
    }
    r = hue2rgb(hNorm + 1 / 3)
    g = hue2rgb(hNorm)
    b = hue2rgb(hNorm - 1 / 3)
  }

  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255)
  ]
}

/**
 * Calculates WCAG 2.2 relative luminance of an RGB color.
 * L = 0.2126 * Rlin + 0.7152 * Glin + 0.0722 * Blin
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function getRelativeLuminance(r, g, b) {
  const parseChannel = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * parseChannel(r) + 0.7152 * parseChannel(g) + 0.0722 * parseChannel(b)
}

/**
 * Calculates WCAG 2.2 contrast ratio between two colors (hex or [r,g,b]).
 * Ratio = (L1 + 0.05) / (L2 + 0.05)
 * @param {string|number[]} color1
 * @param {string|number[]} color2
 * @returns {number}
 */
export function getContrastRatio(color1, color2) {
  const rgb1 = typeof color1 === 'string' ? hexToRgb(color1) : color1
  const rgb2 = typeof color2 === 'string' ? hexToRgb(color2) : color2

  const l1 = getRelativeLuminance(rgb1[0], rgb1[1], rgb1[2])
  const l2 = getRelativeLuminance(rgb2[0], rgb2[1], rgb2[2])

  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Adjusts background lightness in HSL space for contrast against textColor.
 * If text is white, we darken the background.
 * If text is dark, we lighten the background.
 * @param {string} bgHex
 * @param {string} textColor
 * @param {number} minRatio
 * @returns {string} hex representation of the adjusted background color
 */
export function adjustLightnessForContrast(bgHex, textColor, minRatio = 4.5) {
  const rgb = hexToRgb(bgHex)
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2])

  let currentL = l
  let adjustedHex = bgHex

  if (textColor === '#FFFFFF') {
    // Darken background
    while (currentL > 0) {
      currentL = Math.max(0, currentL - 1)
      const adjustedRgb = hslToRgb(h, s, currentL)
      adjustedHex = rgbToHex(adjustedRgb[0], adjustedRgb[1], adjustedRgb[2])
      if (getContrastRatio(adjustedHex, textColor) >= minRatio) {
        break
      }
    }
  } else {
    // Lighten background
    while (currentL < 100) {
      currentL = Math.min(100, currentL + 1)
      const adjustedRgb = hslToRgb(h, s, currentL)
      adjustedHex = rgbToHex(adjustedRgb[0], adjustedRgb[1], adjustedRgb[2])
      if (getContrastRatio(adjustedHex, textColor) >= minRatio) {
        break
      }
    }
  }

  return adjustedHex
}

/**
 * Ensures background color meets WCAG 2.2 AA (>= 4.5:1 ratio) against text color.
 * Adjusts background lightness if contrast falls below 4.5.
 * @param {string} bgHex
 * @param {number} minRatio
 * @returns {{ bgHex: string, textColor: string, ratio: number }}
 */
export function ensureWCAGContrast(bgHex, minRatio = 4.5) {
  const whiteContrast = getContrastRatio(bgHex, '#FFFFFF')
  const darkContrast = getContrastRatio(bgHex, '#111111')

  let textColor = whiteContrast >= darkContrast ? '#FFFFFF' : '#111111'
  let currentRatio = Math.max(whiteContrast, darkContrast)
  let adjustedBg = bgHex

  if (currentRatio < minRatio) {
    adjustedBg = adjustLightnessForContrast(bgHex, textColor, minRatio)
    currentRatio = getContrastRatio(adjustedBg, textColor)
  }

  return { bgHex: adjustedBg, textColor, ratio: currentRatio }
}

/**
 * Extracts distinct color palettes from an image element.
 * Supports 4 modes: 'vibrant', 'muted', 'pastel', 'deep'
 * @param {HTMLImageElement|HTMLCanvasElement} imgElement
 * @param {string} mode ('vibrant', 'muted', 'pastel', 'deep')
 * @returns {string[]} array of 6-8 hex colors
 */
export function generateImagePalettes(imgElement, mode = 'vibrant') {
  let canvas
  const hasCanvas = typeof HTMLCanvasElement !== 'undefined'
  
  if (hasCanvas && imgElement instanceof HTMLCanvasElement) {
    canvas = imgElement
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 100
    const ctx = canvas.getContext('2d')
    if (ctx && imgElement) {
      try {
        ctx.drawImage(imgElement, 0, 0, 100, 100)
      } catch (e) {
        console.error('[color-contrast] Failed to draw image to canvas:', e)
        return getFallbackPalette(mode)
      }
    }
  } else {
    // Node environment with no document or HTMLCanvasElement
    return getFallbackPalette(mode)
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return getFallbackPalette(mode)
  }

  let imgData
  try {
    imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  } catch (e) {
    console.error('[color-contrast] Failed to get image data:', e)
    return getFallbackPalette(mode)
  }

  const pixels = imgData.data
  const colors = []

  // Sample pixels in a grid to ensure we cover different areas of the image
  const steps = 15 // 15x15 = 225 samples
  const stepX = Math.floor(canvas.width / steps) || 1
  const stepY = Math.floor(canvas.height / steps) || 1

  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const idx = (y * canvas.width + x) * 4
      if (idx < pixels.length) {
        const r = pixels[idx]
        const g = pixels[idx + 1]
        const b = pixels[idx + 2]
        const a = pixels[idx + 3]
        if (a >= 200) { // skip highly transparent pixels
          colors.push({ r, g, b })
        }
      }
    }
  }

  if (colors.length === 0) {
    return getFallbackPalette(mode)
  }

  // Convert to HSL to sort/filter based on mode
  const converted = colors.map(rgb => {
    const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b)
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b)
    return { h, s, l, hex }
  })

  // Filter and sort based on active mode
  let filtered = []
  if (mode === 'vibrant') {
    // Favor high saturation, medium lightness
    filtered = converted.filter(c => c.s >= 30 && c.l >= 20 && c.l <= 80)
    filtered.sort((a, b) => b.s - a.s)
  } else if (mode === 'muted') {
    // Favor low/medium saturation
    filtered = converted.filter(c => c.s < 50 && c.l >= 20 && c.l <= 80)
    filtered.sort((a, b) => a.s - b.s)
  } else if (mode === 'pastel') {
    // Favor high lightness, medium/low saturation
    filtered = converted.filter(c => c.l >= 70 && c.s >= 10)
    filtered.sort((a, b) => b.l - a.l)
  } else if (mode === 'deep') {
    // Favor low lightness
    filtered = converted.filter(c => c.l <= 40 && c.l >= 10)
    filtered.sort((a, b) => a.l - b.l)
  }

  // Fallback to all colors if filtered result is too small
  if (filtered.length < 6) {
    filtered = converted
  }

  // Select 6-8 distinct colors (by checking hue / hex distance)
  const result = []
  for (const item of filtered) {
    if (result.length >= 8) break
    const isDistinct = result.every(resColor => {
      const rgb1 = hexToRgb(resColor)
      const rgb2 = hexToRgb(item.hex)
      const dist = Math.sqrt(
        Math.pow(rgb1[0] - rgb2[0], 2) +
        Math.pow(rgb1[1] - rgb2[1], 2) +
        Math.pow(rgb1[2] - rgb2[2], 2)
      )
      return dist > 45 // Ensure color distance is significant enough
    })
    if (isDistinct) {
      result.push(item.hex)
    }
  }

  // If we still don't have enough, relax distance check or pad with remaining
  if (result.length < 6) {
    for (const item of filtered) {
      if (result.length >= 8) break
      if (!result.includes(item.hex)) {
        result.push(item.hex)
      }
    }
  }

  // Absolute fallback if somehow we still have too few
  while (result.length < 6) {
    const fallback = getFallbackPalette(mode)
    for (const fbColor of fallback) {
      if (result.length >= 6) break
      if (!result.includes(fbColor)) {
        result.push(fbColor)
      }
    }
  }

  return result.slice(0, 8)
}

/**
 * Returns a static fallback palette for a given mode.
 * @param {string} mode
 * @returns {string[]}
 */
function getFallbackPalette(mode) {
  if (mode === 'vibrant') {
    return ['#FF3B30', '#FF9500', '#FFCC00', '#4CD964', '#5AC8FA', '#007AFF', '#5856D6', '#FF2D55']
  } else if (mode === 'muted') {
    return ['#8E8E93', '#AEAEB2', '#C7C7CC', '#D1D1D6', '#E5E5EA', '#F2F2F7', '#636366', '#48484A']
  } else if (mode === 'pastel') {
    return ['#FFD1DC', '#FFDFD3', '#FEC8D8', '#D4F0F0', '#E2F0CB', '#B5EAD7', '#C7CEEA', '#E8EAFF']
  } else { // deep
    return ['#1C1C1E', '#2C2C2E', '#3A3A3C', '#1C2730', '#1C3120', '#301C1C', '#241C30', '#0F1C3F']
  }
}
