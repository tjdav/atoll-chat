/**
 * Converts a standard Base64 encoded string to an unpadded Base64URL string.
 *
 * @param {string} s Standard Base64 string
 * @returns {string} Unpadded Base64URL string
 */
export function base64ToBase64url(s) {
  if (typeof s !== 'string') {
    throw new TypeError('s must be a string');
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Converts an unpadded or padded Base64URL string to a standard Base64 string (without adding padding).
 *
 * @param {string} s Base64URL string
 * @returns {string} Standard Base64 string
 */
export function base64urlToBase64(s) {
  if (typeof s !== 'string') {
    throw new TypeError('s must be a string');
  }
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * Converts a Uint8Array byte sequence to an unpadded Base64URL string.
 *
 * @param {Uint8Array} bytes Byte array to encode
 * @returns {string} Unpadded Base64URL string
 */
export function bytesToBase64url(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('bytes must be a Uint8Array');
  }
  if (bytes.length === 0) {
    return '';
  }

  let base64 = '';
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  } else {
    let bin = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(bin);
  }

  return base64ToBase64url(base64);
}

/**
 * Converts an unpadded Base64URL string to a Uint8Array byte array.
 *
 * @param {string} s Unpadded Base64URL string
 * @returns {Uint8Array} Decoded Uint8Array byte array
 */
export function base64urlToBytes(s) {
  if (typeof s !== 'string') {
    throw new TypeError('s must be a string');
  }
  if (s === '') {
    return new Uint8Array(0);
  }

  const b64 = base64urlToBase64(s);

  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } else {
    let padded = b64;
    while (padded.length % 4 !== 0) {
      padded += '=';
    }
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
}
