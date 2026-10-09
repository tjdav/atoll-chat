use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use crate::error::ApiError;

/// Encodes the publisher key signing input per V3 §8.10:
///   u32_be(len(room_id)) || room_id_utf8
///   || epoch_u64_be
///   || publisher_public_key_raw_32_bytes
pub fn encode_publisher_key_signing_input(
    room_id: &str,
    epoch: u64,
    publisher_public_key_raw: &[u8; 32],
) -> Vec<u8> {
    let room_bytes = room_id.as_bytes();
    let mut buf = Vec::with_capacity(4 + room_bytes.len() + 8 + 32);
    buf.extend_from_slice(&(room_bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(room_bytes);
    buf.extend_from_slice(&epoch.to_be_bytes());
    buf.extend_from_slice(publisher_public_key_raw);
    buf
}

/// Verifies an Ed25519 signature over a signing input using a base64url-encoded Ed25519 public key.
pub fn verify_publisher_key_signature(
    identity_pubkey_b64: &str,
    signing_input: &[u8],
    signature_b64: &str,
) -> Result<(), ApiError> {
    let pubkey_bytes = URL_SAFE_NO_PAD
        .decode(identity_pubkey_b64)
        .map_err(|_| ApiError::BadRequest("signature_invalid".to_string()))?;

    if pubkey_bytes.len() != 32 {
        return Err(ApiError::BadRequest("signature_invalid".to_string()));
    }

    let pk_array: [u8; 32] = pubkey_bytes
        .try_into()
        .map_err(|_| ApiError::BadRequest("signature_invalid".to_string()))?;

    let verifying_key = VerifyingKey::from_bytes(&pk_array)
        .map_err(|_| ApiError::BadRequest("signature_invalid".to_string()))?;

    let sig_bytes = URL_SAFE_NO_PAD
        .decode(signature_b64)
        .map_err(|_| ApiError::BadRequest("signature_invalid".to_string()))?;

    if sig_bytes.len() != 64 {
        return Err(ApiError::BadRequest("signature_invalid".to_string()));
    }

    let sig_array: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| ApiError::BadRequest("signature_invalid".to_string()))?;

    let signature = Signature::from_bytes(&sig_array);

    verifying_key
        .verify(signing_input, &signature)
        .map_err(|_| ApiError::BadRequest("signature_invalid".to_string()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn test_encode_publisher_key_signing_input() {
        let room_id = "r_test";
        let epoch = 42u64;
        let pubkey_raw = [0xAAu8; 32];

        let encoded = encode_publisher_key_signing_input(room_id, epoch, &pubkey_raw);

        // Check header (length prefix of "r_test" = 6)
        assert_eq!(&encoded[0..4], &(6u32.to_be_bytes()));
        // Room ID bytes
        assert_eq!(&encoded[4..10], b"r_test");
        // Epoch bytes (42 as u64_be)
        assert_eq!(&encoded[10..18], &(42u64.to_be_bytes()));
        // Publisher pubkey raw bytes
        assert_eq!(&encoded[18..50], &[0xAAu8; 32]);
        assert_eq!(encoded.len(), 50);
    }

    #[test]
    fn test_verify_publisher_key_signature_success_and_failure() {
        let seed = [0x77u8; 32];
        let signing_key = SigningKey::from_bytes(&seed);
        let verifying_key = signing_key.verifying_key();

        let identity_pubkey_b64 = URL_SAFE_NO_PAD.encode(verifying_key.as_bytes());

        let signing_input = b"test_signing_input_payload";
        let signature = signing_key.sign(signing_input);
        let signature_b64 = URL_SAFE_NO_PAD.encode(signature.to_bytes());

        // Valid signature
        assert!(verify_publisher_key_signature(
            &identity_pubkey_b64,
            signing_input,
            &signature_b64
        )
        .is_ok());

        // Tampered signing input
        assert!(verify_publisher_key_signature(
            &identity_pubkey_b64,
            b"tampered_payload",
            &signature_b64
        )
        .is_err());
    }
}
