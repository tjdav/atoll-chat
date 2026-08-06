routerUse((e) => {
  try {
    const h = e.response.header()
    if (h && typeof h.set === 'function') {
      h.set('Content-Security-Policy',
        "default-src 'none'; " +
        "script-src 'self' 'wasm-unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' ws: wss:; " +
        "worker-src 'self' blob:; " +
        "frame-ancestors 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';"
      )
      h.set('X-Content-Type-Options', 'nosniff')
      h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      h.set('X-Frame-Options', 'DENY')
      h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    }
  } catch (err) {
    console.error('[security_headers] Error setting security headers:', err)
  }
  return e.next()
})

