import { open, stat } from 'node:fs/promises'
import { watch } from 'node:fs'

/**
 * Resolves the diagnostic file path for the given keystore path.
 *
 * @param {string} keystorePath - The absolute keystore path.
 * @returns {string} The diagnostic file path.
 */
export function resolveDiagPath (keystorePath) {
  return `${keystorePath}.diag.jsonl`
}

/**
 * Reads the most recent state snapshot from the diagnostic file.
 *
 * Reads the file from the end backwards in fixed-size chunks until a
 * `type: 'state'` line is found. Returns `null` when the file does not
 * exist or contains no state line.
 *
 * @param {string} path - The diagnostic file path.
 * @returns {Promise<{ at: string, data: Record<string, unknown> } | null>}
 */
export async function readLatestState (path) {
  let fileHandle
  try {
    fileHandle = await open(path, 'r')
  } catch {
    return null
  }

  try {
    const stats = await fileHandle.stat()
    let fileSize = stats.size
    if (fileSize === 0) {
      return null
    }

    const chunkSize = 4096
    let bufferRemainder = ''

    while (fileSize > 0) {
      const readLength = Math.min(chunkSize, fileSize)
      fileSize -= readLength

      const buf = Buffer.alloc(readLength)
      await fileHandle.read(buf, 0, readLength, fileSize)
      const chunkText = buf.toString('utf8') + bufferRemainder

      const lines = chunkText.split('\n')
      if (fileSize > 0) {
        bufferRemainder = lines.shift() ?? ''
      } else {
        bufferRemainder = ''
      }

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]?.trim()
        if (!line) {
          continue
        }
        try {
          const parsed = JSON.parse(line)
          if (parsed && typeof parsed === 'object' && parsed.type === 'state') {
            return parsed
          }
        } catch {
          // Skip malformed line
        }
      }
    }

    if (bufferRemainder.trim()) {
      try {
        const parsed = JSON.parse(bufferRemainder.trim())
        if (parsed && typeof parsed === 'object' && parsed.type === 'state') {
          return parsed
        }
      } catch {
        // Skip malformed line
      }
    }

    return null
  } finally {
    await fileHandle.close().catch(() => {})
  }
}

/**
 * Follows the diagnostic file, invoking `onLine` for each new line.
 *
 * Returns a stop function. The stop function is idempotent. The
 * `onLine` callback's synchronous throw does not stop the follower;
 * errors are logged to `io.stderr` when `io` is provided.
 *
 * @param {object} params
 * @param {string} params.path - The diagnostic file path.
 * @param {(line: Record<string, unknown>) => void} params.onLine - Called for each
 *   parsed JSON line.
 * @param {(err: Error) => void} [params.onError] - Called for parse
 *   errors and file-watch errors.
 * @param {boolean} [params.fromStart=false] - When `true`, the follower
 *   starts from the beginning of the file. When `false` (default),
 *   only new lines are delivered.
 * @returns {Promise<() => void>} The stop function.
 */
export async function followDiagFile ({ path, onLine, onError, fromStart = false }) {
  let offset = 0
  let lineBuffer = ''
  let stopped = false
  let fsWatcher = null
  let isReading = false
  let readQueued = false
  let lastIno = null

  try {
    const fileStats = await stat(path)
    lastIno = fileStats.ino
    if (fromStart) {
      offset = 0
    } else {
      offset = fileStats.size
    }
  } catch (err) {
    if (fromStart) {
      offset = 0
    }
  }

  const readNewLines = async () => {
    if (stopped) {
      return
    }
    if (isReading) {
      readQueued = true
      return
    }
    isReading = true

    try {
      let stats
      try {
        stats = await stat(path)
      } catch (err) {
        isReading = false
        if (readQueued) {
          readQueued = false
          setImmediate(readNewLines)
        }
        return
      }

      if (lastIno !== null && stats.ino !== lastIno) {
        offset = 0
        lineBuffer = ''
        lastIno = stats.ino
      }

      if (stats.size < offset) {
        offset = 0
        lineBuffer = ''
      }

      if (stats.size > offset) {
        let fileHandle
        try {
          fileHandle = await open(path, 'r')
        } catch {
          isReading = false
          return
        }

        try {
          if (offset > 0) {
            const checkBuf = Buffer.alloc(1)
            const { bytesRead } = await fileHandle.read(checkBuf, 0, 1, offset - 1)
            if (bytesRead === 1 && checkBuf[0] !== 0x0a) {
              offset = 0
              lineBuffer = ''
            }
          }

          const bytesToRead = stats.size - offset
          const buf = Buffer.alloc(bytesToRead)
          const { bytesRead } = await fileHandle.read(buf, 0, bytesToRead, offset)
          offset += bytesRead

          const text = lineBuffer + buf.subarray(0, bytesRead).toString('utf8')
          const lines = text.split('\n')
          lineBuffer = lines.pop() ?? ''

          for (const rawLine of lines) {
            const trimmed = rawLine.trim()
            if (!trimmed) {
              continue
            }
            let parsed
            try {
              parsed = JSON.parse(trimmed)
            } catch (err) {
              if (onError) {
                onError(err instanceof Error ? err : new Error(String(err)))
              }
              continue
            }
            try {
              onLine(parsed)
            } catch (err) {
              if (onError) {
                onError(err instanceof Error ? err : new Error(String(err)))
              }
            }
          }
        } finally {
          await fileHandle.close().catch(() => {})
        }
      }
    } catch (err) {
      if (onError) {
        onError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      isReading = false
      if (readQueued) {
        readQueued = false
        setImmediate(readNewLines)
      }
    }
  }

  if (fromStart) {
    await readNewLines()
  }

  try {
    fsWatcher = watch(path, (eventType) => {
      if (stopped) {
        return
      }
      if (eventType === 'rename' || eventType === 'change') {
        readNewLines().catch(() => {})
      }
    })
    fsWatcher.on('error', (err) => {
      if (onError) {
        onError(err)
      }
    })
  } catch (err) {
    if (onError) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  return () => {
    if (stopped) {
      return
    }
    stopped = true
    if (fsWatcher) {
      fsWatcher.close()
      fsWatcher = null
    }
  }
}
