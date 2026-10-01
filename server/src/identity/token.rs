use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// Validates that a string is a well-formed username token.
///
/// A token is the 86-character unpadded base64url encoding of the
/// 64-byte SHA-512 output of the client's OprfClient::finalize().
pub fn validate_token(token: &str) -> Result<(), TokenError> {
    if token.len() != 86 {
        tracing::debug!("Token validation failed: invalid length {}", token.len());
        return Err(TokenError::InvalidToken);
    }

    if !token
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        tracing::debug!("Token validation failed: invalid character in token");
        return Err(TokenError::InvalidToken);
    }

    let bytes = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| TokenError::InvalidToken)?;

    if bytes.len() != 64 {
        tracing::debug!("Token validation failed: decoded length {}", bytes.len());
        return Err(TokenError::InvalidToken);
    }

    Ok(())
}

/// Returns the raw bytes of a validated token.
pub fn token_bytes(token: &str) -> Result<[u8; 64], TokenError> {
    validate_token(token)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| TokenError::InvalidToken)?;

    let mut arr = [0u8; 64];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TokenError {
    #[error("invalid username token format")]
    InvalidToken,
}
