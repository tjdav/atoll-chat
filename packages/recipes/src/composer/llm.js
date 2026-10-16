// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Send the composer's messages to an OpenAI-compatible endpoint.
 *
 * @param {import('../types.js').ComposerMessage[]} messages - The messages array produced by prompt builder.
 * @param {import('../types.js').ComposerLlmOptions} options - Options for the LLM call.
 * @returns {Promise<import('../types.js').ComposerLlmResult>} Result of the call.
 * @throws {TypeError} When required options are missing or malformed.
 */
export async function completeComposition (messages, options) {
  if (!Array.isArray(messages)) {
    throw new TypeError('completeComposition: messages must be an array')
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('completeComposition: options must be an object')
  }

  const { upstreamUrl, apiKey, model } = options
  if (typeof upstreamUrl !== 'string' || upstreamUrl.length === 0) {
    throw new TypeError('completeComposition: options.upstreamUrl must be a non-empty string')
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new TypeError('completeComposition: options.apiKey must be a non-empty string')
  }
  if (typeof model !== 'string' || model.length === 0) {
    throw new TypeError('completeComposition: options.model must be a non-empty string')
  }

  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('completeComposition: options.fetch must be a function when provided')
  }

  const timeoutMs = options.timeoutMs ?? 30000
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
    throw new TypeError('completeComposition: options.timeoutMs must be a positive number when provided')
  }

  if (options.temperature !== undefined && typeof options.temperature !== 'number') {
    throw new TypeError('completeComposition: options.temperature must be a number when provided')
  }

  const requestBody = {
    model,
    messages,
    response_format: { type: 'json_object' }
  }
  if (options.temperature !== undefined) {
    requestBody.temperature = options.temperature
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response
  try {
    response = await fetchImpl(upstreamUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        error: {
          code: 'upstream_timeout',
          message: `Upstream request timed out after ${timeoutMs}ms`
        }
      }
    }
    const errMsg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: {
        code: 'upstream_unreachable',
        message: `Upstream request failed: ${errMsg}`
      }
    }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: 'upstream_error',
        message: `Upstream responded with status ${response.status}`,
        status: response.status
      }
    }
  }

  let data
  try {
    data = await response.json()
  } catch {
    return {
      ok: false,
      error: {
        code: 'upstream_invalid_json',
        message: 'Upstream response body was not valid JSON'
      }
    }
  }

  let content
  if (data !== null && typeof data === 'object') {
    const choices = data.choices
    if (Array.isArray(choices) && choices.length > 0) {
      const firstChoice = choices[0]
      if (firstChoice !== null && typeof firstChoice === 'object') {
        const message = firstChoice.message
        if (message !== null && typeof message === 'object') {
          content = message.content
        }
      }
    }
  }

  if (typeof content !== 'string') {
    return {
      ok: false,
      error: {
        code: 'upstream_malformed',
        message: 'Upstream response did not carry choices[0].message.content as a string'
      }
    }
  }

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    return {
      ok: false,
      error: {
        code: 'invalid_json_content',
        message: 'Response content is not valid JSON'
      }
    }
  }

  return {
    ok: true,
    content,
    parsed
  }
}
