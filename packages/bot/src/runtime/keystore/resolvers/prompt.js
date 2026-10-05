import { StringDecoder } from 'node:string_decoder'
import { keychainWriter } from './keychain-write.js'

/**
 * Reads a line of masked input from the terminal.
 *
 * @typedef {(prompt: string) => Promise<string>} Reader - Reads line of masked input.
 */

/**
 * Reads a line of masked input from the terminal.
 *
 * The prompt is written to stderr. Input is read from stdin in raw
 * mode. Each printable character is echoed as an asterisk. Backspace
 * erases the previous asterisk. Enter submits. Ctrl+C and Ctrl+D abort
 * by rejecting.
 *
 * When stdin is not a TTY, the function rejects. The caller treats
 * this as a deferral.
 *
 * @param {string} prompt - The prompt text to display before reading.
 * @returns {Promise<string>} The passphrase the operator typed.
 * @throws {Error} When stdin is not a TTY, when the operator aborts,
 *   or on unexpected I/O errors.
 */
async function defaultReader (prompt) {
  if (!process.stdin.isTTY) {
    throw new Error('stdin is not a TTY')
  }

  return new Promise((resolve, reject) => {
    const wasRaw = Boolean(process.stdin.isRaw)
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let isSettled = false

    process.stderr.write(prompt)

    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()

    const cleanup = () => {
      process.stdin.removeListener('data', onData)
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw)
      }
      process.stdin.pause()
    }

    /**
     * @param {Buffer | string} chunk - Incoming data chunk from stdin.
     */
    const onData = (chunk) => {
      if (isSettled) {
        return
      }
      const str = decoder.write(chunk)
      for (const char of str) {
        const code = char.codePointAt(0)
        if (code === undefined) {
          continue
        }

        if (code === 0x03 || code === 0x04) {
          isSettled = true
          cleanup()
          process.stderr.write('\n')
          reject(new Error('aborted'))
          return
        }

        if (code === 0x0d || code === 0x0a) {
          isSettled = true
          cleanup()
          process.stderr.write('\n')
          resolve(buffer)
          return
        }

        if (code === 0x7f || code === 0x08) {
          if (buffer.length > 0) {
            const chars = Array.from(buffer)
            chars.pop()
            buffer = chars.join('')
            process.stderr.write('\b \b')
          }
          continue
        }

        if (code < 0x20) {
          continue
        }

        buffer += char
        process.stderr.write('*')
      }
    }

    process.stdin.on('data', onData)
  })
}

/**
 * Creates a resolver that prompts the operator for the passphrase on
 * the terminal, then stores it in the platform's credential store
 * (best-effort).
 *
 * @param {object} [options] - Options for the prompt resolver.
 * @param {Reader} [options.reader] - The terminal reader. Defaults to
 *   a masked raw-mode reader that writes to stderr. Parameterized for
 *   testing.
 * @param {import('./keychain-write.js').Writer} [options.writer] - The
 *   keychain writer. Defaults to keychainWriter(). Parameterized for
 *   testing.
 * @returns {import('./index.js').Resolver} The prompt resolver.
 */
export function promptResolver ({
  reader = defaultReader,
  writer = keychainWriter()
} = {}) {
  return {
    id: 'prompt',
    async resolve (ctx) {
      if (!ctx.interactive) {
        return null
      }
      let secret
      try {
        secret = await reader(`Keystore passphrase for ${ctx.botId}: `)
      } catch {
        return null
      }
      if (typeof secret !== 'string' || secret.length === 0) {
        return null
      }
      try {
        await writer(ctx.botId, secret)
      } catch {
        /* Best-effort. A failed write does not prevent the passphrase from being returned for this process's keystore load. */
      }
      return secret
    }
  }
}
