// database/pb_hooks/csp.pb.js

routerUse((e) => {
  const res = e.response

  /**
   * Retrieves the value of the environment variable named by the key.
   *
   * @param {string} key - The environment variable name.
   * @returns {string|undefined} The environment variable value or undefined if not present.
   */
  function getEnv (key) {
    if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
      return process.env[key]
    }

    if (typeof $os !== 'undefined' && typeof $os.getenv === 'function') {
      return $os.getenv(key)
    }

    return undefined
  }

  const pbUrl = getEnv('ATOLL_POCKETBASE_URL') || 'http://localhost:8090'
  const pushUrl = getEnv('ATOLL_PUSH_WORKER_URL') || 'http://localhost:3001'
  const isReportOnly = getEnv('ATOLL_CSP_REPORT_ONLY') === 'true'

  const cspDirectives = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `connect-src 'self' ${pbUrl} ${pushUrl} ws: wss: stun: turn: turns:`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'"
  ]

  const cspHeaderName = isReportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'

  // In report-only mode (or optionally in enforcing if desired), set report-uri
  if (isReportOnly) {
    cspDirectives.push('report-uri /api/csp-report')
  }

  res.header().set(cspHeaderName, cspDirectives.join('; '))
  res.header().set('X-Frame-Options', 'DENY')
  res.header().set('X-Content-Type-Options', 'nosniff')
  res.header().set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return e.next()
})

// Endpoint to receive CSP reports
routerAdd('POST', '/api/csp-report', (e) => {
  try {
    const data = new DynamicModel({
      'csp-report': null
    })
    e.bindBody(data)

    const report = data['csp-report'] || {}
    console.warn('[CSP Violation Report]:', JSON.stringify(report))
    return e.json(200, { success: true })
  } catch (err) {
    return e.json(400, { error: err.toString() })
  }
})
