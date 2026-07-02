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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10
    })

    if (res.statusCode >= 400) {
      return e.json(400, {
        error: 'Target metadata unreachable',
        statusCode: res.statusCode
      })
    }

    // Truncate HTML to 100KB to prevent memory exhaustion and limit regex processing
    let html = (res.text || '').substring(0, 100000)

    if (!html && res.raw) {
      // Fallback for some PocketBase versions where res.text might be empty but res.raw exists
      html = res.raw.substring(0, 100000)
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

    // 1. Extract <title>
    // Search up to 1000 chars for the closing tag, then truncate to 250
    const titleMatch = html.match(/<title[^>]{0,500}>([\s\S]{0,1000}?)<\/title>/i)
    if (titleMatch) {
      title = titleMatch[1].substring(0, 250).trim()
    }

    // 2. Extract <meta> tags
    // Limit each meta tag to 2048 chars to prevent ReDoS
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
    } catch (err) {
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

    return e.json(200, {
      title: title || domain || url,
      description: description,
      image: image,
      domain: domain,
      url: url
    })

  } catch (err) {
    return e.json(400, {
      error: 'Target metadata unreachable',
      details: err.toString()
    })
  }
}, $apis.requireAuth())
