/**
 * @file Cryptographic performance benchmarks suite.
 */

/**
 * Injects cryptographic helper methods into the browser-side `window.__perf` object.
 * @param {import('@playwright/test').Page} page - The Playwright Page instance.
 * @param {object} params - Cryptographic parameters generated on Node side.
 * @param {string} params.govPublicKey - Base64 encoded governance public key.
 * @param {string} params.govPrivateKey - Base64 encoded governance private key.
 * @param {string} params.fileKey - Base64 encoded file encryption key.
 * @param {string} params.fileNonce - Base64 encoded file encryption nonce.
 * @returns {Promise<void>} Resolves when the scripts are successfully injected and initialized.
 * @throws {Error} Throws if browser injection fails.
 */
export async function inject (page, params) {
  await page.evaluate(async (cryptoParams) => {
    if (!window.__perf) {
      window.__perf = {}
    }

    // Set up cryptographic benchmark helper state using Node-provided parameters
    window.__perf.cryptoState = {
      key: cryptoParams.fileKey,
      nonce: cryptoParams.fileNonce,
      ciphertext: null,
      fileBytes: null,
      fileCiphertext: null,
      govPublicKey: cryptoParams.govPublicKey,
      govPrivateKey: cryptoParams.govPrivateKey,
      govCiphertext: null
    }

    /**
     * Initializes state and warms up cryptographic helpers.
     * @returns {Promise<void>} Resolves when initialization is complete.
     */
    window.__perf.initCrypto = async function () {
      const state = window.__perf.cryptoState

      // Warmup msg encrypt
      state.ciphertext = await window.__perf.execute('worker:crypto_secretbox_easy', {
        message: 'Hello World',
        nonce: state.nonce,
        key: state.key
      })

      // Warmup 1MB file bytes (generating in chunks to prevent QuotaExceededError)
      state.fileBytes = new Uint8Array(1024 * 1024)
      for (let i = 0; i < state.fileBytes.length; i += 65536) {
        const chunk = state.fileBytes.subarray(i, i + 65536)
        crypto.getRandomValues(chunk)
      }

      state.fileCiphertext = await window.__perf.execute('worker:crypto_secretbox_easy', {
        message: state.fileBytes,
        nonce: state.nonce,
        key: state.key
      })

      // Warmup Gov seal
      state.govCiphertext = await window.__perf.execute('worker:crypto_box_seal', {
        message: 'Secret Governance Info',
        publicKey: state.govPublicKey
      })
    }

    /**
     * Benchmarks message encryption.
     * @returns {Promise<unknown>} The ciphertext result.
     */
    window.__perf.benchMsgEncrypt = async function () {
      const state = window.__perf.cryptoState
      return window.__perf.execute('worker:crypto_secretbox_easy', {
        message: 'Hello Performance Benchmark',
        nonce: state.nonce,
        key: state.key
      })
    }

    /**
     * Benchmarks message decryption.
     * @returns {Promise<unknown>} The plaintext result.
     */
    window.__perf.benchMsgDecrypt = async function () {
      const state = window.__perf.cryptoState
      return window.__perf.execute('worker:crypto_secretbox_open_easy', {
        ciphertext: state.ciphertext,
        nonce: state.nonce,
        key: state.key
      })
    }

    /**
     * Benchmarks governance box sealing.
     * @returns {Promise<unknown>} The sealed message result.
     */
    window.__perf.benchGovSeal = async function () {
      const state = window.__perf.cryptoState
      return window.__perf.execute('worker:crypto_box_seal', {
        message: 'Secret Governance Info',
        publicKey: state.govPublicKey
      })
    }

    /**
     * Benchmarks governance box opening.
     * @returns {Promise<unknown>} The unsealed message result.
     */
    window.__perf.benchGovSealOpen = async function () {
      const state = window.__perf.cryptoState
      return window.__perf.execute('worker:crypto_box_seal_open', {
        ciphertext: state.govCiphertext,
        publicKey: state.govPublicKey,
        privateKey: state.govPrivateKey
      })
    }

    /**
     * Benchmarks file encryption (1MB).
     * @returns {Promise<unknown>} The encrypted file result.
     */
    window.__perf.benchFileEncrypt = async function () {
      const state = window.__perf.cryptoState
      return window.__perf.execute('worker:crypto_secretbox_easy', {
        message: state.fileBytes,
        nonce: state.nonce,
        key: state.key
      })
    }

    /**
     * Benchmarks file decryption (1MB).
     * @returns {Promise<unknown>} The decrypted file result.
     */
    window.__perf.benchFileDecrypt = async function () {
      const state = window.__perf.cryptoState
      return window.__perf.execute('worker:decrypt_file', {
        encryptedBuffer: state.fileCiphertext,
        nonce: state.nonce,
        key: state.key
      })
    }
  }, params)

  // Trigger initCrypto inside the page context
  await page.evaluate(async () => {
    await window.__perf.initCrypto()
  })
}

/**
 * Registers cryptographic benchmarks with the Mitata runner.
 * @param {import('@playwright/test').Page} _page - The Playwright Page instance (unused).
 * @param {Function} group - The Mitata group registration function.
 * @param {Function} bench - The Mitata bench registration function.
 * @returns {void}
 */
export function register (_page, group, bench) {
  group('Cryptographic performance (P0)', () => {
    bench('Msg encrypt throughput', async () => {
      await _page.evaluate(() => window.__perf.benchMsgEncrypt())
    })
    bench('Msg decrypt throughput', async () => {
      await _page.evaluate(() => window.__perf.benchMsgDecrypt())
    })
    bench('Governance box seal', async () => {
      await _page.evaluate(() => window.__perf.benchGovSeal())
    })
    bench('Governance box seal_open', async () => {
      await _page.evaluate(() => window.__perf.benchGovSealOpen())
    })
    bench('File encrypt (1MB) throughput', async () => {
      await _page.evaluate(() => window.__perf.benchFileEncrypt())
    })
    bench('File decrypt (1MB) throughput', async () => {
      await _page.evaluate(() => window.__perf.benchFileDecrypt())
    })
  })
}

/**
 * Runs any custom non-Mitata benchmarks. For crypto, there are none.
 * @param {import('@playwright/test').Page} _page - The Playwright Page instance.
 * @returns {Promise<Record<string, never>>} Resolves to an empty stats object.
 */
export async function runCustom (_page) {
  return {}
}

/**
 * Baseline threshold performance limits for cryptographic operations.
 * @type {Record<string, { p50?: number; min_p50?: number; msg: string }>}
 */
export const baselineLimits = {
  'Msg encrypt throughput': {
    p50: 15,
    msg: 'Message encryption is too slow'
  },
  'Msg decrypt throughput': {
    p50: 15,
    msg: 'Message decryption is too slow'
  },
  'Governance box seal': {
    p50: 20,
    msg: 'Governance box sealing is too slow'
  },
  'Governance box seal_open': {
    p50: 20,
    msg: 'Governance box seal-opening is too slow'
  },
  'File encrypt (1MB) throughput': {
    p50: 100,
    msg: '1MB File encryption is too slow'
  },
  'File decrypt (1MB) throughput': {
    p50: 100,
    msg: '1MB File decryption is too slow'
  }
}
