routerAdd('GET', '/api/link-extraction', (e) => {
  const url = e.request.url.query().get('url')
  if (!url) {
    return e.json(400, { error: 'URL is required' })
  }

  try {
    const res = $http.send({
      url: url,
      method: 'GET',
      headers: {
        'User-Agent': 'facebookexternalhit/1.1; AtollBot/1.0'
      },
      timeout: 10
    })

    if (res.statusCode >= 400) {
      return e.json(400, {
        error: 'Target metadata unreachable',
        statusCode: res.statusCode
      })
    }

    // Truncate HTML to 500KB to prevent memory exhaustion and limit regex processing
    let html = (res.text || '').substring(0, 500000)

    if (!html && res.raw) {
      // Fallback for some PocketBase versions where res.text might be empty but res.raw exists
      html = res.raw.substring(0, 500000)
    }

    let title = ''
    let description = ''
    let image = ''

    // Helper to extract attribute value from a tag string
    const getAttr = (tag, attr) => {
      // Robust match that handles specific quote types to allow mixed quotes in content
      const match = tag.match(new RegExp(`${attr}\\s*=\\s*(?:"([^"]{0,2048}?)"|'([^']{0,2048}?)'|([^\\s>]{1,2048}))`, 'i'))
      if (match) {
        let val = match[1] || match[2] || match[3] || ''
        // Unescape common HTML entities that might be in attribute values
        return val.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      }
      return null
    }

    // extract title
    const titleMatch = html.match(/<title[^>]{0,500}>([\s\S]{0,1000}?)<\/title>/i)
    if (titleMatch) {
      title = titleMatch[1].substring(0, 250).trim()
    }

    // extract meta tags
    const metaTags = html.match(/<meta\s+[^>]{0,2048}?>/gi) || []
    for (const tag of metaTags) {
      const name = getAttr(tag, 'name')
      const property = getAttr(tag, 'property')
      const content = getAttr(tag, 'content')

      if (!content) {
        continue
      }

      if (property === 'og:title' && content.length > 0) {
        title = content.substring(0, 250)
      } else if ((name === 'description' || property === 'og:description') && content.length > 0) {
        // Prefer og:description if it exists, or use the first description found
        if (property === 'og:description' || !description) {
          description = content.substring(0, 500)
        }
      } else if (property === 'og:image' && content.length > 0) {
        image = content.substring(0, 2048)
      }
    }

    let domain = ''
    try {
      const domainMatch = url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/im)
      if (domainMatch) {
        domain = domainMatch[1]
      }
    } catch {
    }

    if (image && !image.startsWith('http')) {
      if (image.startsWith('//')) {
        image = (url.startsWith('https') ? 'https:' : 'http:') + image
      } else if (image.startsWith('/')) {
        const urlObj = url.match(/^(https?:\/\/[^\/]+)/i)
        if (urlObj) {
          image = urlObj[1] + image
        }
      }
    }

    // If parsing yields absolutely nothing, return 400 Bad Request as requested
    if (!title && !description && !image) {
      return e.json(400, { error: 'Target metadata unreachable' })
    }

    let mediaId = ''
    let fileKey = ''
    let fileNonce = ''

    if (image && image.startsWith('http')) {
      try {
        const tempFile = $filesystem.fileFromURL(image, 15)
        if (tempFile) {
          let rawBytesStr = ''
          try {
            rawBytesStr = readerToString(tempFile)
          } finally {
            tempFile.close()
          }

          if (rawBytesStr) {
            const aesKey = $security.randomString(32)
            const encryptedStr = $security.encrypt(rawBytesStr, aesKey)

            const encryptedFile = $filesystem.fileFromBytes(encryptedStr, 'preview.enc')
            const mediaCollection = $app.findCollectionByNameOrId('media')
            const mediaRecord = new Record(mediaCollection)
            mediaRecord.set('file', encryptedFile)
            $app.save(mediaRecord)

            mediaId = mediaRecord.id
            fileKey = aesKey
            fileNonce = 'AES-GCM'
          }
        }
      } catch {
        // Fallback gracefully on image download/processing error
      }
    }

    return e.json(200, {
      title: title || domain || url,
      description: description,
      image: image,
      domain: domain,
      url: url,
      media_id: mediaId,
      file_key: fileKey,
      file_nonce: fileNonce
    })

  } catch (err) {
    return e.json(400, {
      error: 'Target metadata unreachable',
      details: err.toString()
    })
  }
}, $apis.requireAuth())
