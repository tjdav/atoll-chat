// pb_hooks/proxy.pb.js

routerAdd('GET', '/api/proxy-opengraph', (e) => {
  const url = e.request.url.query().get('url')
  if (!url) {
    return e.json(400, { error: 'URL is required' })
  }

  try {
    const res = $http.send({
      url: url,
      method: 'GET',
      headers: {
        'User-Agent': 'AtollChat-Proxy/1.0'
      },
      timeout: 10
    })

    const html = res.text || ''

    let title = ''
    let description = ''
    let image = ''

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (titleMatch) {
      title = titleMatch[1].trim()
    }

    const ogTitleMatch = html.match(/property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
    if (ogTitleMatch) {
      title = ogTitleMatch[1]
    }

    const metaDescMatch = html.match(/name=["']description["'][^>]*content=["']([^"']*)["']/i)
    if (metaDescMatch) {
      description = metaDescMatch[1]
    }

    const ogDescMatch = html.match(/property=["']og:description["'][^>]*content=["']([^"']*)["']/i)
    if (ogDescMatch) {
      description = ogDescMatch[1]
    }

    const ogImageMatch = html.match(/property=["']og:image["'][^>]*content=["']([^"']*)["']/i)
    if (ogImageMatch) {
      image = ogImageMatch[1]
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

    return e.json(200, {
      title: title || domain || url,
      description: description,
      image: image,
      domain: domain,
      url: url
    })

  } catch (err) {
    return e.json(200, {
      error: err.toString(),
      title: url
    })
  }
}, $apis.requireAuth())
