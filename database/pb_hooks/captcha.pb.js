// database/pb_hooks/captcha.pb.js

// Proxy route to retrieve a new challenge from the internal push-worker
routerAdd('GET', '/api/altcha/challenge', (e) => {
  const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://localhost:3001'

  try {
    const res = $http.send({
      url: pushWorkerUrl + '/altcha/challenge',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10
    })

    if (res.statusCode >= 400) {
      return e.json(res.statusCode, { error: 'Failed to retrieve challenge from worker' })
    }

    const json = res.json
    if (!json) {
      return e.json(500, { error: 'Invalid or empty response from challenge worker' })
    }

    return e.json(200, json)
  } catch (err) {
    return e.json(500, { error: err.message })
  }
})
