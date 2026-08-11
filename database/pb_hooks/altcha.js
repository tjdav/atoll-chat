// database/pb_hooks/altcha.js

/**
 * Verifies the Altcha security challenge solution with the push worker.
 *
 * @param {string} altchaPayload - The Altcha challenge payload to verify.
 * @throws {Error} If the push worker URL is missing or the network request fails unexpectedly.
 * @returns {boolean} True if the challenge is solved successfully; false otherwise.
 */
const verifyAltchaSolution = (altchaPayload) => {
  const pushWorkerUrl = $os.getenv('ATOLL_PUSH_WORKER_URL') || 'http://localhost:3001'
  try {
    const res = $http.send({
      url: pushWorkerUrl + '/altcha/verify',
      method: 'POST',
      body: JSON.stringify({ payload: altchaPayload }),
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10
    })

    if (res.statusCode >= 500) {
      throw new Error('Push worker returned server error status: ' + res.statusCode)
    }

    return res.statusCode === 200
  } catch (err) {
    $app.logger().error('[verifyAltchaSolution] Altcha verification request failed', 'error', err.message || String(err))
    throw err
  }
}

module.exports = {
  verifyAltchaSolution
}
