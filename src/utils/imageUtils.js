/**
 * Compresses an image.
 * @param {File|Blob|string|HTMLImageElement|HTMLCanvasElement} source - The image source.
 * @param {Object} options - Compression options.
 * @param {number} [options.maxWidth=1200] - Maximum width.
 * @param {number} [options.maxHeight=1200] - Maximum height.
 * @param {number} [options.quality=0.8] - Compression quality (0 to 1).
 * @param {string} [options.format='image/webp'] - Output format.
 * @param {boolean} [options.cropToSquare=false] - Whether to crop to a square.
 * @returns {Promise<Blob>} - Resolves to the compressed image Blob.
 */
export async function compressImage (source, options = {}) {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.8,
    format = 'image/webp',
    cropToSquare = false
  } = options

  let img
  let shouldRevoke = false

  if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
    img = source
  } else {
    img = new Image()
    const promise = new Promise((resolve, reject) => {
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to load image source'))
    })

    if (source instanceof Blob) {
      const url = URL.createObjectURL(source)
      img.src = url
      shouldRevoke = true
    } else {
      img.src = source
    }

    await promise
  }

  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    let targetWidth = img.width
    let targetHeight = img.height

    if (cropToSquare) {
      const size = Math.min(targetWidth, targetHeight)

      // Calculate scaled size if it exceeds constraints
      let finalSize = size
      if (finalSize > maxWidth || finalSize > maxHeight) {
        finalSize = Math.min(maxWidth, maxHeight)
      }

      canvas.width = finalSize
      canvas.height = finalSize

      const sourceSize = Math.min(img.width, img.height)
      const sourceX = (img.width - sourceSize) / 2
      const sourceY = (img.height - sourceSize) / 2

      ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, finalSize, finalSize)
    } else {
      const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight, 1.0)
      targetWidth *= ratio
      targetHeight *= ratio

      canvas.width = targetWidth
      canvas.height = targetHeight
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Canvas toBlob failed'))
        }
      }, format, quality)
    })
  } finally {
    if (shouldRevoke && img.src) {
      URL.revokeObjectURL(img.src)
    }
  }
}
