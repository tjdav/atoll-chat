/**
 * Pusher Protocol v7 WebSocket client for Atoll Bot SDK.
 */

/**
 * @typedef {object} WebSocketClient
 * @property {() => Promise<void>} connect - Opens the socket and completes the handshake.
 * @property {() => Promise<void>} close - Closes the socket and stops the ping timer.
 * @property {(channelName: string, handler: (eventName: string, data: unknown) => void) => () => void} subscribe - Registers a channel handler.
 * @property {(event: 'open' | 'close' | 'error', handler: (payload?: unknown) => void) => () => void} on - Registers a lifecycle handler.
 * @property {() => string | undefined} socketId - The current Pusher socket id.
 * @property {() => boolean} isConnected - True between connection_established and socket close.
 */

const CHANNEL_NAME_REGEX = /^[a-z][a-z0-9_-]*$/

/**
 * Unrefs a timer if available so it doesn't hold the Node process open.
 *
 * @param {NodeJS.Timeout | number | null} timer - Timer handle.
 */
function unrefTimer (timer) {
  if (timer && typeof timer === 'object' && typeof timer.unref === 'function') {
    timer.unref()
  }
}

/**
 * Creates a Pusher Protocol v7 client for the bot's channel.
 *
 * @param {object} options - Configuration options.
 * @param {string} options.socketUrl - Base WebSocket URL for Sockudo, including scheme.
 * @param {string} options.appKey - The Sockudo app key.
 * @param {(socketId: string, channelName: string) => Promise<{ auth: string, channel_data?: string }>} options.authCallback - Called for each private channel subscription.
 * @param {typeof globalThis.WebSocket} [options.WebSocketImpl=globalThis.WebSocket] - The WebSocket constructor.
 * @param {import('../diagnostics/logger.js').Logger} [options.logger] - Optional logger for connection lifecycle diagnostics.
 * @param {number} [options.connectTimeoutMs=15000] - Time to wait for connection_established after opening socket.
 * @param {number} [options.pingIntervalMs=30000] - Interval between client pings.
 * @param {number} [options.pongTimeoutMs=10000] - Time to wait for pusher:pong after sending a ping.
 * @param {string} [options.clientName='atollbot'] - The client query parameter value.
 * @param {string} [options.clientVersion='1.0.0'] - The version query parameter value.
 * @returns {WebSocketClient} The client.
 */
export function createWebSocketClient ({
  socketUrl,
  appKey,
  authCallback,
  WebSocketImpl = globalThis.WebSocket,
  logger,
  connectTimeoutMs = 15000,
  pingIntervalMs = 30000,
  pongTimeoutMs = 10000,
  clientName = 'atollbot',
  clientVersion = '1.0.0'
}) {
  if (typeof socketUrl !== 'string' || socketUrl.trim() === '') {
    throw new Error('socketUrl must be a non-empty string')
  }

  let cleanUrl = socketUrl.trim()
  while (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1)
  }

  if (!cleanUrl.startsWith('ws://') && !cleanUrl.startsWith('wss://')) {
    throw new Error('socketUrl must begin with ws:// or wss://')
  }

  if (typeof appKey !== 'string' || appKey.trim() === '') {
    throw new Error('appKey must be a non-empty string')
  }

  if (typeof authCallback !== 'function') {
    throw new Error('authCallback must be a function')
  }

  if (typeof WebSocketImpl !== 'function') {
    throw new Error('WebSocketImpl must be a function')
  }

  /** @type {InstanceType<typeof WebSocketImpl> | null} */
  let ws = null
  /** @type {string | undefined} */
  let currentSocketId
  let connected = false

  /** @type {Promise<void> | null} */
  let connectPromise = null
  /** @type {Promise<void> | null} */
  let closePromise = null

  /** @type {NodeJS.Timeout | number | null} */
  let connectTimer = null
  /** @type {NodeJS.Timeout | number | null} */
  let pingTimer = null
  /** @type {NodeJS.Timeout | number | null} */
  let pongTimer = null

  /** @type {Map<string, Set<(eventName: string, data: unknown) => void>>} */
  const trackedChannels = new Map()

  /** @type {Map<'open' | 'close' | 'error', Set<(payload?: unknown) => void>>} */
  const lifecycleHandlers = new Map([
    ['open', new Set()],
    ['close', new Set()],
    ['error', new Set()]
  ])

  /**
   * @param {'open' | 'close' | 'error'} event - Lifecycle event name.
   * @param {unknown} [payload] - Event payload.
   */
  function emitLifecycle (event, payload) {
    const handlers = lifecycleHandlers.get(event)
    if (handlers) {
      for (const handler of Array.from(handlers)) {
        try {
          handler(payload)
        } catch (err) {
          if (logger) {
            logger.warn('lifecycle handler error', {
              event,
              code: err instanceof Error ? err.message : String(err)
            })
          }
        }
      }
    }
  }

  function clearTimers () {
    if (connectTimer !== null) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
    if (pingTimer !== null) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (pongTimer !== null) {
      clearTimeout(pongTimer)
      pongTimer = null
    }
  }

  function startPingTimers () {
    if (pingTimer !== null) {
      clearInterval(pingTimer)
    }
    pingTimer = setInterval(() => {
      if (!connected || !ws || ws.readyState !== 1) {
        return
      }
      try {
        ws.send(JSON.stringify({
          event: 'pusher:ping',
          data: {}
        }))
      } catch (err) {
        if (logger) {
          logger.warn('ping send error', {
            code: err instanceof Error ? err.message : String(err)
          })
        }
      }

      if (pongTimer !== null) {
        clearTimeout(pongTimer)
      }
      pongTimer = setTimeout(() => {
        pongTimer = null
        if (logger) {
          logger.warn('pong timeout, closing socket')
        }
        if (ws) {
          try {
            ws.close(4000, 'pong timeout')
          } catch {
            // Ignore close errors
          }
        }
      }, pongTimeoutMs)
      unrefTimer(pongTimer)
    }, pingIntervalMs)
    unrefTimer(pingTimer)
  }

  /**
   * @param {string} channelName - Channel name to subscribe to.
   */
  async function sendSubscribe (channelName) {
    if (!connected || !currentSocketId || !ws || ws.readyState !== 1) {
      return
    }

    let authResult
    try {
      authResult = await authCallback(currentSocketId, channelName)
    } catch (err) {
      if (logger) {
        logger.error('channel auth failed', {
          channel: channelName,
          code: err instanceof Error ? err.message : String(err)
        })
      }
      emitLifecycle('error', err)
      return
    }

    const payload = {
      event: 'pusher:subscribe',
      data: {
        channel: channelName,
        auth: authResult.auth,
        ...(authResult.channel_data !== undefined ? { channel_data: authResult.channel_data } : {})
      }
    }

    try {
      ws.send(JSON.stringify(payload))
      if (logger) {
        logger.debug('subscribed to channel', {
          channel: channelName
        })
      }
    } catch (err) {
      if (logger) {
        logger.error('failed to send subscribe message', {
          channel: channelName,
          code: err instanceof Error ? err.message : String(err)
        })
      }
      emitLifecycle('error', err)
    }
  }

  async function resubscribeAll () {
    for (const channelName of trackedChannels.keys()) {
      await sendSubscribe(channelName)
    }
  }

  /**
   * Connects to WebSocket server.
   *
   * @returns {Promise<void>} Resolves when connection_established is received.
   */
  function connect () {
    if (connected) {
      return Promise.resolve()
    }
    if (connectPromise) {
      return connectPromise
    }

    closePromise = null

    connectPromise = new Promise((resolve, reject) => {
      const fullUrl = `${cleanUrl}/app/${encodeURIComponent(appKey)}?protocol=7&client=${encodeURIComponent(clientName)}&version=${encodeURIComponent(clientVersion)}`

      let socket
      try {
        socket = new WebSocketImpl(fullUrl)
      } catch (err) {
        connectPromise = null
        emitLifecycle('error', err)
        reject(err)
        return
      }

      ws = socket

      let handshakeDone = false

      connectTimer = setTimeout(() => {
        if (!handshakeDone) {
          const timeoutErr = new Error('Connection timeout')
          cleanupAndReject(timeoutErr)
        }
      }, connectTimeoutMs)
      unrefTimer(connectTimer)

      /**
       * @param {Error | unknown} err - Error cause.
       */
      const cleanupAndReject = (err) => {
        clearTimers()
        connected = false
        currentSocketId = undefined
        handshakeDone = false
        connectPromise = null
        if (socket) {
          try {
            socket.close()
          } catch {
            // Ignore close errors
          }
        }
        emitLifecycle('error', err)
        reject(err)
      }

      socket.onopen = () => {
        // Wait for pusher:connection_established from server
      }

      socket.onmessage = async (event) => {
        let msg
        try {
          msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        } catch {
          return
        }

        if (!msg || typeof msg !== 'object') {
          return
        }

        const eventName = msg.event

        if (!handshakeDone) {
          if (eventName === 'pusher:connection_established') {
            handshakeDone = true
            if (connectTimer !== null) {
              clearTimeout(connectTimer)
              connectTimer = null
            }

            /** @type {Record<string, any>} */
            let dataObj = {}
            if (typeof msg.data === 'string') {
              try {
                dataObj = JSON.parse(msg.data)
              } catch {
                dataObj = {}
              }
            } else if (msg.data && typeof msg.data === 'object') {
              dataObj = msg.data
            }

            currentSocketId = dataObj['socket_id']
            connected = true

            if (logger) {
              logger.debug('websocket connected', {
                socket_id: currentSocketId
              })
            }

            startPingTimers()
            await resubscribeAll()
            emitLifecycle('open')
            resolve()
            return
          } else if (eventName === 'pusher:error') {
            cleanupAndReject(msg)
            return
          }
        }

        // Handle post-handshake messages
        if (eventName === 'pusher:ping') {
          if (ws && ws.readyState === 1) {
            try {
              ws.send(JSON.stringify({
                event: 'pusher:pong',
                data: {}
              }))
            } catch {
              // Ignore ping response failure
            }
          }
          return
        }

        if (eventName === 'pusher:pong') {
          if (pongTimer !== null) {
            clearTimeout(pongTimer)
            pongTimer = null
          }
          return
        }

        if (eventName === 'pusher:error') {
          if (logger) {
            logger.error('pusher error received')
          }
          emitLifecycle('error', msg)
          return
        }

        if (
          eventName === 'pusher_internal:subscription_succeeded' ||
          eventName === 'pusher_internal:member_added' ||
          eventName === 'pusher_internal:member_removed'
        ) {
          return
        }

        // Channel event dispatch
        const channelName = msg.channel
        const rawData = msg.data

        if (channelName) {
          const handlers = trackedChannels.get(channelName)
          if (handlers) {
            for (const handler of Array.from(handlers)) {
              try {
                handler(eventName, rawData)
              } catch {
                if (logger) {
                  logger.warn('channel handler exception', {
                    event: eventName,
                    channel: channelName
                  })
                }
              }
            }
          }
        } else {
          // If channel is omitted in message, dispatch to all tracked channels
          for (const [ch, handlers] of trackedChannels.entries()) {
            for (const handler of Array.from(handlers)) {
              try {
                handler(eventName, rawData)
              } catch {
                if (logger) {
                  logger.warn('channel handler exception', {
                    event: eventName,
                    channel: ch
                  })
                }
              }
            }
          }
        }
      }

      socket.onerror = (err) => {
        if (!handshakeDone) {
          cleanupAndReject(err)
        } else {
          emitLifecycle('error', err)
        }
      }

      socket.onclose = (event) => {
        const code = event ? event.code : 1000
        const reason = event ? event.reason : ''

        clearTimers()
        const wasConnected = connected
        connected = false
        currentSocketId = undefined
        connectPromise = null

        if (logger) {
          logger.debug('websocket closed', {
            code,
            reason
          })
        }

        if (!handshakeDone) {
          cleanupAndReject(new Error(`WebSocket closed before handshake: ${code} ${reason}`))
        } else if (wasConnected) {
          emitLifecycle('close', {
            code,
            reason
          })
        }
      }
    })

    return connectPromise
  }

  /**
   * Closes the socket connection.
   *
   * @returns {Promise<void>} Resolves when socket has closed.
   */
  function close () {
    if (closePromise) {
      return closePromise
    }

    if (!ws || ws.readyState === 3 || (!connected && !connectPromise)) {
      clearTimers()
      connected = false
      currentSocketId = undefined
      connectPromise = null
      return Promise.resolve()
    }

    closePromise = new Promise((resolve) => {
      const activeSocket = ws

      clearTimers()

      // Send unsubscribes if connected and open
      if (connected && activeSocket && activeSocket.readyState === 1) {
        for (const channelName of trackedChannels.keys()) {
          try {
            activeSocket.send(JSON.stringify({
              event: 'pusher:unsubscribe',
              data: { channel: channelName }
            }))
            if (logger) {
              logger.debug('unsubscribed from channel', {
                channel: channelName
              })
            }
          } catch {
            // Ignore send failures on close
          }
        }
      }

      const existingOnClose = activeSocket ? activeSocket.onclose : null

      if (activeSocket) {
        activeSocket.onclose = (event) => {
          if (existingOnClose) {
            try {
              existingOnClose.call(activeSocket, event)
            } catch {
              // Ignore
            }
          }
          resolve()
        }

        try {
          activeSocket.close()
        } catch {
          resolve()
        }
      } else {
        resolve()
      }
    })

    return closePromise
  }

  /**
   * Registers a handler for a channel.
   *
   * @param {string} channelName - Pusher channel name.
   * @param {(eventName: string, data: unknown) => void} handler - Message handler function.
   * @returns {() => void} Unsubscribe function.
   */
  function subscribe (channelName, handler) {
    if (typeof channelName !== 'string' || channelName.trim() === '') {
      throw new Error('channelName must be a non-empty string')
    }
    if (!CHANNEL_NAME_REGEX.test(channelName)) {
      throw new Error('channelName must match ^[a-z][a-z0-9_-]*$')
    }
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function')
    }

    let handlers = trackedChannels.get(channelName)
    const isNewChannel = !handlers

    if (!handlers) {
      handlers = new Set()
      trackedChannels.set(channelName, handlers)
    }

    handlers.add(handler)

    if (isNewChannel && connected) {
      sendSubscribe(channelName)
    }

    return () => {
      const chHandlers = trackedChannels.get(channelName)
      if (chHandlers) {
        chHandlers.delete(handler)
        if (chHandlers.size === 0) {
          trackedChannels.delete(channelName)
          if (connected && ws && ws.readyState === 1) {
            try {
              ws.send(JSON.stringify({
                event: 'pusher:unsubscribe',
                data: { channel: channelName }
              }))
              if (logger) {
                logger.debug('unsubscribed from channel', {
                  channel: channelName
                })
              }
            } catch {
              // Ignore send failure on unsubscribe
            }
          }
        }
      }
    }
  }

  /**
   * Registers a lifecycle event handler.
   *
   * @param {'open' | 'close' | 'error'} event - Event name.
   * @param {(payload?: unknown) => void} handler - Event handler.
   * @returns {() => void} Unregister function.
   */
  function on (event, handler) {
    if (event !== 'open' && event !== 'close' && event !== 'error') {
      throw new Error('Invalid lifecycle event name')
    }
    if (typeof handler !== 'function') {
      throw new Error('handler must be a function')
    }

    const handlers = lifecycleHandlers.get(event)
    if (handlers) {
      handlers.add(handler)
    }

    return () => {
      const set = lifecycleHandlers.get(event)
      if (set) {
        set.delete(handler)
      }
    }
  }

  return {
    connect,
    close,
    subscribe,
    on,
    socketId: () => currentSocketId,
    isConnected: () => connected
  }
}
