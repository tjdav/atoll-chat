import sodium from 'libsodium-wrappers-sumo'

async function runTest () {
  await sodium.ready

  // Simulate Alice (Inviter)
  const aliceKeys = sodium.crypto_box_keypair()
  const alicePublicBase64 = sodium.to_base64(aliceKeys.publicKey)

  // Simulate Bob (Receiver)
  const bobKeys = sodium.crypto_box_keypair()
  const bobPrivateBase64 = sodium.to_base64(bobKeys.privateKey)

  // Simulate Room Key
  const roomKey = sodium.randombytes_buf(32)
  const nonce = sodium.randombytes_buf(24)

  // Alice wraps the room key for Bob
  const encryptedRoomKey = sodium.crypto_box_easy(
    roomKey,
    nonce,
    bobKeys.publicKey,
    aliceKeys.privateKey
  )

  const encryptedRoomKeyBase64 = sodium.to_base64(encryptedRoomKey)
  const nonceBase64 = sodium.to_base64(nonce)

  console.log('--- Test Data ---')
  console.log('Inviter Public Key:', alicePublicBase64)
  console.log('Receiver Private Key:', bobPrivateBase64)
  console.log('Room Key (Original):', sodium.to_base64(roomKey))
  console.log('Encrypted Room Key:', encryptedRoomKeyBase64)
  console.log('Nonce:', nonceBase64)

  // Now simulate the worker unwrapping
  try {
    const unwrapped = sodium.crypto_box_open_easy(
      sodium.from_base64(encryptedRoomKeyBase64),
      sodium.from_base64(nonceBase64),
      sodium.from_base64(alicePublicBase64),
      sodium.from_base64(bobPrivateBase64)
    )
    console.log('Room Key (Unwrapped):', sodium.to_base64(unwrapped))

    if (sodium.to_base64(roomKey) === sodium.to_base64(unwrapped)) {
      console.log('SUCCESS: Room key unwrapped correctly.')
    } else {
      console.error('FAILURE: Room key mismatch.')
    }
  } catch (e) {
    console.error('FAILURE: Decryption error:', e)
  }
}

runTest()
