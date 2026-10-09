use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// Validates that a string is a well-formed username token (holding lookup_token).
///
/// Under V3 token split (§6.19), the server stores `lookup_token`, which is the
/// 86-character unpadded base64url encoding of the 64-byte HKDF-Expand output
/// of the raw OPRF finalization token with info "username-lookup-v1".
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

/// Derives the 22-character `sender_ref` from an 86-character `username_token`.
///
/// Decodes `username_token` (unpadded base64url -> 64 bytes), takes the first 16 bytes,
/// and re-encodes as unpadded base64url (22 characters).
pub fn sender_ref_from_username_token(token: &str) -> Result<String, TokenError> {
    let bytes = token_bytes(token)?;
    Ok(URL_SAFE_NO_PAD.encode(&bytes[..16]))
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TokenError {
    #[error("invalid username token format")]
    InvalidToken,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sender_ref_pinned_vector() {
        // 64 zero bytes encoded in unpadded base64url (86 chars)
        let zero_token = URL_SAFE_NO_PAD.encode([0u8; 64]);
        assert_eq!(zero_token.len(), 86);

        let sender_ref = sender_ref_from_username_token(&zero_token).unwrap();
        assert_eq!(sender_ref.len(), 22);

        // 16 zero bytes encoded in unpadded base64url is "AAAAAAAAAAAAAAAAAAAAAA"
        let expected_ref = URL_SAFE_NO_PAD.encode([0u8; 16]);
        assert_eq!(sender_ref, expected_ref);
        assert_eq!(sender_ref, "AAAAAAAAAAAAAAAAAAAAAA");
    }

    #[test]
    fn test_sender_ref_invalid_inputs() {
        // Wrong length
        assert_eq!(
            sender_ref_from_username_token("short_token"),
            Err(TokenError::InvalidToken)
        );

        // Invalid base64 characters
        let mut invalid_char_token = URL_SAFE_NO_PAD.encode([0u8; 64]);
        invalid_char_token.replace_range(0..1, "+");
        assert_eq!(
            sender_ref_from_username_token(&invalid_char_token),
            Err(TokenError::InvalidToken)
        );

        // Wrong length token
        let wrong_len_token = "A".repeat(85);
        assert_eq!(
            sender_ref_from_username_token(&wrong_len_token),
            Err(TokenError::InvalidToken)
        );
    }
}
