use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

#[derive(Debug, thiserror::Error)]
pub enum DeviceNameError {
    #[error("encrypted device name must be valid base64url")]
    InvalidBase64,
    #[error("encrypted device name decodes to {0} bytes, must be between 28 and 284")]
    InvalidLength(usize),
}

pub fn validate_encrypted_device_name(value: &str) -> Result<(), DeviceNameError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| DeviceNameError::InvalidBase64)?;

    if bytes.len() < 28 || bytes.len() > 284 {
        return Err(DeviceNameError::InvalidLength(bytes.len()));
    }

    Ok(())
}
