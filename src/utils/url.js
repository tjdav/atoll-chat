/**
 * Normalizes a base URL and/or path into a valid, safe URL.
 * Prevents protocol-relative "//" URL traps when relative paths (like "/") are used.
 *
 * @param {string} url The URL or concatenated URL string to normalize.
 * @returns {string} The fully normalized URL.
 */
export function normalizeUrl (url) {
  if (!url) {
    return url
  }

  // Resolve protocol-relative "//" URL traps resulting from relative base URLs (like "/")
  if (url.startsWith('//') && !url.startsWith('///')) {
    url = '/' + url.substring(2)
  }

  // Separate query/hash from the main path to avoid modifying them
  let path = url
  let suffix = ''

  const questionMarkIndex = url.indexOf('?')
  const hashIndex = url.indexOf('#')

  let splitIndex = -1
  if (questionMarkIndex !== -1 && hashIndex !== -1) {
    splitIndex = Math.min(questionMarkIndex, hashIndex)
  } else if (questionMarkIndex !== -1) {
    splitIndex = questionMarkIndex
  } else if (hashIndex !== -1) {
    splitIndex = hashIndex
  }

  if (splitIndex !== -1) {
    path = url.substring(0, splitIndex)
    suffix = url.substring(splitIndex)
  }

  // De-duplicate extra slashes in the path while preserving the protocol
  const protocolMatch = path.match(/^(https?:\/\/)/i)
  if (protocolMatch) {
    const protocol = protocolMatch[1]
    const rest = path.substring(protocol.length)
    path = protocol + rest.replace(/\/+/g, '/')
  } else {
    path = path.replace(/\/+/g, '/')
  }

  return path + suffix
}
