// database/pb_hooks/security_headers.pb.js

routerAdd('*', (e) => {
  e.response.header().Set('Content-Security-Policy',
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
  e.response.header().Set('X-Content-Type-Options', 'nosniff')
  e.response.header().Set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  e.response.header().Set('X-Frame-Options', 'DENY')
  e.response.header().Set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return e.next()
}, { priority: 1 })
