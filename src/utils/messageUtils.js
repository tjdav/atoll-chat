
/**
 * DEPRECATED: This utility is no longer used.
 * Message encryption and sending is now handled by the Web Worker.
 */
export async function sendEncryptedMessage () {
  throw new Error('sendEncryptedMessage is deprecated. Use the Web Worker SEND_MESSAGE task instead.')
}
