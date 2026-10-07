import { HttpRequestError } from '../../errors.js'

/**
 * @typedef {object} SseEvent
 * @property {string} event - The event type. Defaults to 'message' when the stream sends a bare data line without an event line.
 * @property {string} data - The concatenated data lines. Multiple data lines in one event are joined with \n. The trailing newline is stripped.
 * @property {string | null} id - The event's id, if the stream sent an id line. Null when no id was sent.
 */

/**
 * @typedef {object} SseClient
 * @property {() => Promise<void>} connect - Opens the stream. Resolves when HTTP response arrives with status 200 and Content-Type: text/event-stream. Rejects with HttpRequestError otherwise.
 * @property {() => Promise<void>} close - Aborts the stream and resolves when the underlying fetch has settled. Emits onClose with { code: 0 }.
 * @property {() => string | null} getLastEventId - The most recent id seen on the stream. Null when no id has been seen.
 * @property {() => boolean} isConnected - True between a successful connect() and the stream's end.
 * @property {() => number | null} getRetryMs - The most recent retry value in milliseconds, or null when none was received.
 */

/**
 * Creates an SSE client for a single stream.
 *
 * @param {object} options - Options object.
 * @param {string} options.serverUrl - Base URL of the server, without a trailing slash.
 * @param {string} options.botToken - The bot's authentication token.
 * @param {string} options.path - Stream path beginning with '/'.
 * @param {(event: SseEvent) => void} options.onEvent - Called for every dispatched SSE event.
 * @param {(err: Error) => void} [options.onError] - Called when the stream fails mid-flight.
 * @param {(reason: { code: number, cause?: unknown }) => void} [options.onClose] - Called when the stream ends.
 * @param {string} [options.initialLastEventId] - The Last-Event-ID header value to send on the first connection.
 * @param {Record<string, string>} [options.headers] - Additional headers.
 * @param {typeof globalThis.fetch} [options.fetchImpl=globalThis.fetch] - The fetch implementation.
 * @param {import('../diagnostics/logger.js').Logger} [options.logger] - Optional logger.
 * @param {number} [options.connectTimeoutMs=15000] - Time in milliseconds to wait for the response headers before aborting.
 * @returns {SseClient} - The created SSE client.
 */
export function createSseClient ({
  serverUrl,
  botToken,
  path,
  onEvent,
  onError,
  onClose,
  initialLastEventId,
  headers,
  fetchImpl = globalThis.fetch,
  logger,
  connectTimeoutMs = 15000
}) {
  if (typeof serverUrl !== 'string' || serverUrl.trim() === '') {
    throw new Error('serverUrl must be a non-empty string')
  }
  let parsedUrl
  try {
    parsedUrl = new URL(serverUrl)
  } catch {
    throw new Error('serverUrl must be a valid absolute URL')
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('serverUrl scheme must be http: or https:')
  }

  if (typeof botToken !== 'string' || botToken.trim() === '') {
    throw new Error('botToken must be a non-empty string')
  }

  if (typeof path !== 'string') {
    throw new Error('path must be a string')
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    throw new Error('path must not be an absolute URL')
  }
  if (!path.startsWith('/')) {
    throw new Error('path must be a string beginning with "/"')
  }

  if (typeof onEvent !== 'function') {
    throw new Error('onEvent must be a function')
  }

  if (onError !== undefined && typeof onError !== 'function') {
    throw new Error('onError must be a function')
  }

  if (onClose !== undefined && typeof onClose !== 'function') {
    throw new Error('onClose must be a function')
  }

  if (headers !== undefined && (typeof headers !== 'object' || headers === null)) {
    throw new Error('headers must be an object')
  }

  if (initialLastEventId !== undefined && typeof initialLastEventId !== 'string') {
    throw new Error('initialLastEventId must be a string')
  }

  const cleanServerUrl = serverUrl.replace(/\/+$/, '')
  const fullUrl = cleanServerUrl + path
  const cleanPath = path.split('?')[0] ?? path

  /** @type {string | null} */
  let lastEventIdBuffer = initialLastEventId ?? null
  /** @type {number | null} */
  let retryBuffer = null

  let connected = false
  let closed = false
  let userAborted = false

  /** @type {AbortController | null} */
  let abortController = null
  /** @type {Promise<void> | null} */
  let streamSettlePromise = null

  /**
   * Consumes body stream and parses lines.
   *
   * @param {ReadableStream<Uint8Array> | null} body - The stream body.
   * @returns {Promise<void>} - Resolves when stream finishes or settles.
   */
  async function consumeStream (body) {
    let dataBuffer = ''
    let eventTypeBuffer = ''
    let lineBuffer = ''

    const decoder = new TextDecoder('utf-8')

    /**
     * Dispatches an SSE event if dataBuffer is not empty.
     */
    function dispatchEvent () {
      if (dataBuffer === '') {
        dataBuffer = ''
        eventTypeBuffer = ''
        return
      }

      const data = dataBuffer.endsWith('\n') ? dataBuffer.slice(0, -1) : dataBuffer
      const eventType = eventTypeBuffer || 'message'
      const eventObj = {
        event: eventType,
        data,
        id: lastEventIdBuffer
      }

      dataBuffer = ''
      eventTypeBuffer = ''

      if (logger) {
        logger.debug('sse event', {
          path: cleanPath,
          event: eventObj.event,
          has_id: Boolean(eventObj.id)
        })
      }

      try {
        onEvent(eventObj)
      } catch {
        // Consumer exceptions should not break the stream parser
      }
    }

    /**
     * Processes a single SSE line.
     *
     * @param {string} line - The line string.
     */
    function processLine (line) {
      if (line === '') {
        dispatchEvent()
        return
      }

      if (line.startsWith(':')) {
        return
      }

      const colonIdx = line.indexOf(':')
      let field = line
      let value = ''

      if (colonIdx !== -1) {
        field = line.slice(0, colonIdx)
        value = line.slice(colonIdx + 1)
        if (value.startsWith(' ')) {
          value = value.slice(1)
        }
      }

      if (field === 'data') {
        dataBuffer += value + '\n'
      } else if (field === 'event') {
        eventTypeBuffer = value
      } else if (field === 'id') {
        if (!value.includes('\0')) {
          lastEventIdBuffer = value
        }
      } else if (field === 'retry') {
        if (/^\d+$/.test(value)) {
          retryBuffer = parseInt(value, 10)
        }
      }
    }

    /**
     * Scans lineBuffer and extracts/processes complete lines.
     *
     * @param {boolean} isFinal - True if stream has ended.
     */
    function processLineBuffer (isFinal) {
      while (lineBuffer.length > 0) {
        let breakIdx = -1
        let delimLength = 1

        for (let i = 0; i < lineBuffer.length; i++) {
          const ch = lineBuffer[i]
          if (ch === '\n') {
            breakIdx = i
            delimLength = 1
            break
          } else if (ch === '\r') {
            if (i + 1 < lineBuffer.length) {
              if (lineBuffer[i + 1] === '\n') {
                breakIdx = i
                delimLength = 2
              } else {
                breakIdx = i
                delimLength = 1
              }
              break
            } else if (isFinal) {
              breakIdx = i
              delimLength = 1
              break
            } else {
              // Wait for next chunk to determine if CRLF or standalone CR
              return
            }
          }
        }

        if (breakIdx === -1) {
          if (isFinal && lineBuffer.length > 0) {
            processLine(lineBuffer)
            lineBuffer = ''
          }
          break
        }

        const line = lineBuffer.slice(0, breakIdx)
        lineBuffer = lineBuffer.slice(breakIdx + delimLength)
        processLine(line)
      }
    }

    try {
      if (body) {
        // @ts-ignore - ReadableStream in Node 22 is an AsyncIterable
        for await (const chunk of body) {
          if (closed || userAborted) {
            break
          }
          lineBuffer += decoder.decode(chunk, { stream: true })
          processLineBuffer(false)
        }
      }

      const rest = decoder.decode()
      if (rest) {
        lineBuffer += rest
      }
      processLineBuffer(true)

      connected = false
      closed = true

      if (logger) {
        logger.debug('sse closed', {
          path: cleanPath,
          last_event_id: lastEventIdBuffer
        })
      }

      if (onClose) {
        try {
          onClose({ code: 0 })
        } catch {
          // ignore
        }
      }
    } catch (err) {
      connected = false
      closed = true

      if (userAborted || (abortController && abortController.signal.aborted)) {
        if (logger) {
          logger.debug('sse closed', {
            path: cleanPath,
            last_event_id: lastEventIdBuffer
          })
        }
        if (onClose) {
          try {
            onClose({ code: 0 })
          } catch {
            // ignore
          }
        }
      } else {
        const errorObj = err instanceof Error ? err : new Error(String(err))
        if (logger) {
          logger.warn('sse stream error', {
            path: cleanPath,
            message: errorObj.message
          })
        }
        if (onError) {
          try {
            onError(errorObj)
          } catch {
            // ignore
          }
        }
        if (onClose) {
          try {
            onClose({
              code: 0,
              cause: errorObj
            })
          } catch {
            // ignore
          }
        }
      }
    }
  }

  return {
    async connect () {
      if (connected) {
        return
      }

      userAborted = false
      closed = false
      abortController = new AbortController()

      if (logger) {
        logger.debug('sse connect', { path: cleanPath })
      }

      /** @type {Record<string, string>} */
      const reqHeaders = {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache'
      }

      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          const lower = k.toLowerCase()
          if (lower !== 'authorization' && lower !== 'last-event-id') {
            reqHeaders[k] = String(v)
          }
        }
      }

      reqHeaders['Authorization'] = `Bearer ${botToken}`
      if (lastEventIdBuffer !== null && lastEventIdBuffer !== undefined) {
        reqHeaders['Last-Event-ID'] = lastEventIdBuffer
      }

      let timedOut = false
      const timeoutId = setTimeout(() => {
        timedOut = true
        if (abortController) {
          abortController.abort()
        }
      }, connectTimeoutMs)

      let res
      try {
        res = await fetchImpl(fullUrl, {
          method: 'GET',
          headers: reqHeaders,
          signal: abortController.signal
        })
      } catch (fetchErr) {
        clearTimeout(timeoutId)
        if (logger) {
          logger.error('sse connect failed', {
            path: cleanPath,
            status: 0
          })
        }
        if (timedOut) {
          const timeoutErr = new HttpRequestError(
            `HTTP request failed (GET ${path}): connect timeout after ${connectTimeoutMs}ms`
          )
          Object.assign(timeoutErr, {
            status: 0,
            url: fullUrl,
            method: 'GET',
            body: null,
            responseErrorCode: null
          })
          throw timeoutErr
        }

        const networkErr = new HttpRequestError(
          `HTTP request failed (GET ${path}): ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
          { cause: fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)) }
        )
        Object.assign(networkErr, {
          status: 0,
          url: fullUrl,
          method: 'GET',
          body: null,
          responseErrorCode: null
        })
        throw networkErr
      } finally {
        clearTimeout(timeoutId)
      }

      if (res.status !== 200) {
        if (logger) {
          logger.error('sse connect failed', {
            path: cleanPath,
            status: res.status
          })
        }
        let bodyText = null
        try {
          bodyText = await res.text()
        } catch {
          bodyText = null
        }
        const httpErr = new HttpRequestError(
          `HTTP request failed (GET ${path}): status ${res.status}`
        )
        Object.assign(httpErr, {
          status: res.status,
          url: fullUrl,
          method: 'GET',
          body: bodyText,
          responseErrorCode: null
        })
        throw httpErr
      }

      const contentType = res.headers ? res.headers.get('content-type') : null
      if (!contentType || !contentType.includes('text/event-stream')) {
        if (logger) {
          logger.error('sse connect failed', {
            path: cleanPath,
            status: res.status
          })
        }
        const httpErr = new HttpRequestError(
          `HTTP request failed (GET ${path}): invalid content-type ${contentType}`
        )
        Object.assign(httpErr, {
          status: res.status,
          url: fullUrl,
          method: 'GET',
          body: null,
          responseErrorCode: null
        })
        throw httpErr
      }

      connected = true
      if (logger) {
        logger.debug('sse connected', {
          path: cleanPath,
          status: 200
        })
      }

      streamSettlePromise = consumeStream(res.body)
    },

    async close () {
      if (closed && !connected) {
        return
      }
      userAborted = true
      if (abortController) {
        abortController.abort()
      }
      if (streamSettlePromise) {
        await streamSettlePromise
      } else {
        closed = true
      }
    },

    getLastEventId () {
      return lastEventIdBuffer
    },

    isConnected () {
      return connected
    },

    getRetryMs () {
      return retryBuffer
    }
  }
}
