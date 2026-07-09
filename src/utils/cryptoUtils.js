/**
 * Registers a new passkey with the PRF extension enabled.
 *
 * @param {string} username - The username to associate with the passkey.
 * @param {Uint8Array} challengeBuffer - A random challenge buffer (usually 32 bytes).
 * @param {Uint8Array} [saltBuffer] - Optional 32-byte salt buffer for immediate PRF evaluation.
 * @returns {Promise<Object>} A promise resolving to { credentialId, prfAvailable, prfResult }.
 */
export async function createPasskey (username, challengeBuffer, saltBuffer) {
  if (!window.PublicKeyCredential) {
    throw new Error('WebAuthn is not supported on this device or browser.')
  }

  const prfExtension = {}
  if (saltBuffer) {
    prfExtension.eval = { first: saltBuffer }
  }

  const publicKeyCredentialCreationOptions = {
    challenge: challengeBuffer,
    rp: {
      name: 'Atoll Chat',
      id: window.location.hostname
    },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: username,
      displayName: username
    },
    pubKeyCredParams: [{
      alg: -7,
      type: 'public-key'
    }, {
      alg: -257,
      type: 'public-key'
    }],
    authenticatorSelection: {
      userVerification: 'required',
      residentKey: 'required',
      requireResidentKey: true
    },
    extensions: {
      prf: prfExtension
    }
  }

  /** @type {any} */
  const credentialsContainer = navigator.credentials
  const credential = await credentialsContainer.create({
    publicKey: publicKeyCredentialCreationOptions
  })

  const extensionResults = credential.getClientExtensionResults()
  const prfEnabled = !!(extensionResults.prf && extensionResults.prf.enabled)

  let prfResult = null
  if (extensionResults.prf && extensionResults.prf.results && extensionResults.prf.results.first) {
    prfResult = new Uint8Array(extensionResults.prf.results.first)
  } else if (extensionResults.prf && extensionResults.prf.first) {
    prfResult = new Uint8Array(extensionResults.prf.first)
  }

  return {
    credentialId: new Uint8Array(credential.rawId),
    prfAvailable: prfEnabled,
    prfResult
  }
}

/**
 * Derives a 32-byte Key Encryption Key (KEK) from a passkey using the WebAuthn PRF extension.
 *
 * @param {Uint8Array} credentialId - The ID of the credential to use.
 * @param {Uint8Array} challengeBuffer - A random challenge buffer (usually 32 bytes).
 * @param {Uint8Array} saltBuffer - A 32-byte salt buffer for the PRF extension.
 * @returns {Promise<Uint8Array>} A promise that resolves to the 32-byte derived KEK.
 * @throws {Error} If the WebAuthn PRF extension is not supported or fails.
 */
export async function deriveKeyFromPasskey (credentialId, challengeBuffer, saltBuffer) {
  if (!window.PublicKeyCredential) {
    throw new Error('WebAuthn is not supported on this device or browser.')
  }

  /** @type {any} */
  const credentialsContainer = navigator.credentials
  const assertion = await credentialsContainer.get({
    publicKey: {
      challenge: challengeBuffer,
      allowCredentials: [{
        type: 'public-key',
        id: credentialId
      }],
      userVerification: 'required',
      extensions: {
        prf: {
          eval: {
            first: saltBuffer
          }
        }
      }
    }
  })

  const extensionResults = assertion.getClientExtensionResults()

  // PRF results can be in results.first (standard) or directly in prf (some implementations)
  let prfBuffer = null
  if (extensionResults.prf && extensionResults.prf.results && extensionResults.prf.results.first) {
    prfBuffer = extensionResults.prf.results.first
  } else if (extensionResults.prf && extensionResults.prf.first) {
    prfBuffer = extensionResults.prf.first
  }

  if (!prfBuffer) {
    throw new Error('WebAuthn PRF extension result was not found. Please ensure PRF is supported.')
  }

  return new Uint8Array(prfBuffer)
}
