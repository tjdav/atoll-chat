use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// Validates that a string is a well-formed encrypted display name.
///
/// Format (client-produced):
///   nonce || AES-256-GCM(display_name)
/// where nonce is 12 bytes and the GCM tag is appended by the cipher.
///
/// Minimum length: 12 (nonce) + 0 (empty plaintext) + 16 (tag) = 28 bytes.
/// Maximum length: 12 + 256 (max display name) + 16 = 284 bytes.
pub fn validate_encrypted_display(value: &str) -> Result<(), DisplayError> {
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        tracing::debug!("Encrypted display validation failed: invalid alphabet");
        return Err(DisplayError::InvalidDisplay);
    }

    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| DisplayError::InvalidDisplay)?;

    if bytes.len() < 28 || bytes.len() > 284 {
        tracing::debug!(
            "Encrypted display validation failed: decoded length {}",
            bytes.len()
        );
        return Err(DisplayError::InvalidDisplay);
    }

    Ok(())
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DisplayError {
    #[error("invalid encrypted display format")]
    InvalidDisplay,
}
