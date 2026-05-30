/* global sodium, importScripts */
importScripts('/assets/libsodium-sumo.js')
importScripts('/assets/libsodium-wrappers.js')

/**
 * The Worker Script for Atoll Chat
 * Handles heavy cryptographic operations off the main thread.
 */

async function init () {
  try {
    await sodium.ready
    self.postMessage({ type: 'WORKER_READY' })
  } catch (err) {
    console.error('Worker Init Error:', err)
  }
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data

  // Handle WORKER_READY check if sent from main thread (optional)
  if (type === 'CHECK_READY') {
    self.postMessage({ type: 'WORKER_READY' })
    return
  }

  try {
    if (type === 'test-rpc') {
      self.postMessage({ id, type, payload, result: 'ACK' })
      return
    }

    if (type === 'generateSalt') {
      const salt = sodium.randombytes_buf(16)
      self.postMessage({ id, type, result: salt })
      return
    }

    if (type === 'deriveKeyFromPin') {
      const { pin, salt } = payload
      const KEK = await sodium.crypto_pwhash(
        32,
        pin,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13
      )
      self.postMessage({ id, type, result: KEK })
      return
    }

    self.postMessage({ id, type, error: `Unknown task type: ${type}` })
  } catch (error) {
    self.postMessage({ id, type, error: error.message })
  }
}

init()
