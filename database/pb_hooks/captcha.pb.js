// database/pb_hooks/captcha.pb.js

// Proxy route to retrieve a new challenge from the internal push-worker
routerAdd('GET', '/api/altcha/challenge', (e) => {
  const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://127.0.0.1:3000'

  try {
    let res
    try {
      res = $http.send({
        url: pushWorkerUrl + '/altcha/challenge',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10
      })
    } catch (primaryErr) {
      if (pushWorkerUrl !== 'http://127.0.0.1:3000') {
        res = $http.send({
          url: 'http://127.0.0.1:3000/altcha/challenge',
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10
        })
      } else {
        throw primaryErr
      }
    }

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
