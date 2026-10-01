use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use server::identity::{validate_encrypted_device_name, DeviceNameError};

#[test]
fn test_valid_ciphertext_lengths() {
    // 28 bytes (minimum)
    let min_bytes = vec![0u8; 28];
    let min_b64 = URL_SAFE_NO_PAD.encode(&min_bytes);
    assert!(validate_encrypted_device_name(&min_b64).is_ok());

    // 284 bytes (maximum)
    let max_bytes = vec![0u8; 284];
    let max_b64 = URL_SAFE_NO_PAD.encode(&max_bytes);
    assert!(validate_encrypted_device_name(&max_b64).is_ok());

    // 100 bytes (typical)
    let mid_bytes = vec![0u8; 100];
    let mid_b64 = URL_SAFE_NO_PAD.encode(&mid_bytes);
    assert!(validate_encrypted_device_name(&mid_b64).is_ok());
}

#[test]
fn test_invalid_lengths() {
    // 27 bytes (too short)
    let short_bytes = vec![0u8; 27];
    let short_b64 = URL_SAFE_NO_PAD.encode(&short_bytes);
    match validate_encrypted_device_name(&short_b64) {
        Err(DeviceNameError::InvalidLength(len)) => assert_eq!(len, 27),
        _ => panic!("Expected InvalidLength"),
    }

    // 285 bytes (too long)
    let long_bytes = vec![0u8; 285];
    let long_b64 = URL_SAFE_NO_PAD.encode(&long_bytes);
    match validate_encrypted_device_name(&long_b64) {
        Err(DeviceNameError::InvalidLength(len)) => assert_eq!(len, 285),
        _ => panic!("Expected InvalidLength"),
    }
}

#[test]
fn test_invalid_base64() {
    // Non-base64 characters
    assert!(matches!(
        validate_encrypted_device_name("invalid!chars@123456789012345678"),
        Err(DeviceNameError::InvalidBase64)
    ));

    // Padding characters ('=')
    let bytes = vec![0u8; 28];
    let padded_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    if padded_b64.contains('=') {
        assert!(matches!(
            validate_encrypted_device_name(&padded_b64),
            Err(DeviceNameError::InvalidBase64)
        ));
    }
}
