/**
 * Traverses an object or array to extract all transferable objects (ArrayBuffer or ArrayBuffer views).
 * Safely handles circular references and ignores non-serializable properties or expected errors.
 *
 * @param {any} obj The input object or array to extract transferables from.
 * @param {Set<any>} [seen] A set containing already visited objects to prevent infinite recursion.
 * @returns {ArrayBuffer[]} An array of extracted ArrayBuffer transferable objects.
 * @throws {Error} Re-throws unexpected critical system errors that are not standard property access or type errors.
 */
export function getTransferables (obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object') {
    return []
  }
  if (seen.has(obj)) {
    return []
  }
  seen.add(obj)

  const transferables = []

  if (obj instanceof ArrayBuffer) {
    transferables.push(obj)
  } else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
    transferables.push(obj.buffer)
  } else {
    try {
      const keys = Object.keys(obj)
      for (let i = 0; i < keys.length; i++) {
        const val = obj[keys[i]]
        if (val && typeof val === 'object') {
          transferables.push(...getTransferables(val, seen))
        }
      }
    } catch (err) {
      /* Re-throw unexpected system or network errors.
         Ignore only expected TypeErrors or SecurityErrors (non-serializable/restricted properties),
         returning whatever transferables we have already gathered up to this point. */
      if (err instanceof TypeError || (err instanceof Error && (err.name === 'SecurityError' || err.name === 'TypeError'))) {
        return Array.from(new Set(transferables))
      }
      throw err
    }
  }

  return Array.from(new Set(transferables))
}

export default getTransferables
