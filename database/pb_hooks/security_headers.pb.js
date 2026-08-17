routerUse((e) => {
  try {
    const h = e.response.header()
    if (h && typeof h.set === 'function') {
      h.set('Cross-Origin-Opener-Policy', 'same-origin')
      h.set('Cross-Origin-Embedder-Policy', 'credentialless')
      h.set('Access-Control-Allow-Origin', '*')
      h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      h.set('Access-Control-Allow-Headers', '*')
      h.set('X-Content-Type-Options', 'nosniff')
      h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      h.set('X-Frame-Options', 'DENY')
      h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    }
  } catch (err) {
    console.error('[security_headers] Error setting security headers:', err)
  }
  if (e.request && e.request.method === 'OPTIONS') {
    return e.noContent(204)
  }
  return e.next()
})

