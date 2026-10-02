use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use rand::RngCore;
use sqlx::{Row, SqlitePool};
use subtle::ConstantTimeEq;
use thiserror::Error;

/// Crockford Base32 alphabet (excludes I, L, O, U).
const CROCKFORD_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Argon2id parameters per OWASP defaults:
/// m_cost = 19456 (19 MiB), t_cost = 2, p_cost = 1, output length = 32 bytes.
pub const ARGON2_M_COST: u32 = 19456;
pub const ARGON2_T_COST: u32 = 2;
pub const ARGON2_P_COST: u32 = 1;
pub const ARGON2_HASH_LEN: usize = 32;
pub const ARGON2_SALT_LEN: usize = 16;

/// Code format: 20 characters Crockford Base32 (100 bits entropy).
pub const RECOVERY_CODE_LENGTH: usize = 20;

#[derive(Error, Debug)]
pub enum RecoveryCodeError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Argon2 error")]
    Argon2,
    #[error("Invalid presented code")]
    InvalidCode,
}

/// Generate a fresh 20-character Crockford Base32 recovery code.
pub fn generate() -> String {
    let mut rng = rand::rngs::OsRng;
    generate_with_rng(&mut rng)
}

/// Generate a recovery code using a specific RNG (useful for deterministic tests).
pub fn generate_with_rng<R: RngCore>(rng: &mut R) -> String {
    let mut bytes = [0u8; RECOVERY_CODE_LENGTH];
    rng.fill_bytes(&mut bytes);

    let mut code_chars = String::with_capacity(RECOVERY_CODE_LENGTH);
    for b in bytes {
        let idx = (b as usize) % CROCKFORD_ALPHABET.len();
        code_chars.push(CROCKFORD_ALPHABET[idx] as char);
    }
    code_chars
}

/// Hash a recovery code with Argon2id and a fresh 16-byte salt.
pub fn hash(
    code: &str,
) -> Result<([u8; ARGON2_HASH_LEN], [u8; ARGON2_SALT_LEN]), RecoveryCodeError> {
    let mut salt = [0u8; ARGON2_SALT_LEN];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    hash_with_salt(code, &salt)
}

/// Hash a recovery code with Argon2id and a provided salt.
pub fn hash_with_salt(
    code: &str,
    salt: &[u8; ARGON2_SALT_LEN],
) -> Result<([u8; ARGON2_HASH_LEN], [u8; ARGON2_SALT_LEN]), RecoveryCodeError> {
    let params = Params::new(
        ARGON2_M_COST,
        ARGON2_T_COST,
        ARGON2_P_COST,
        Some(ARGON2_HASH_LEN),
    )
    .map_err(|_| RecoveryCodeError::Argon2)?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = [0u8; ARGON2_HASH_LEN];
    argon2
        .hash_password_into(code.as_bytes(), salt, &mut out)
        .map_err(|_| RecoveryCodeError::Argon2)?;

    Ok((out, *salt))
}

/// Verify a presented code against a stored (code_hash, code_salt) pair.
pub fn verify(presented_code: &str, stored_hash: &[u8], stored_salt: &[u8]) -> bool {
    if stored_salt.len() != ARGON2_SALT_LEN || stored_hash.len() != ARGON2_HASH_LEN {
        return false;
    }

    let mut salt_arr = [0u8; ARGON2_SALT_LEN];
    salt_arr.copy_from_slice(stored_salt);

    let computed = match hash_with_salt(presented_code, &salt_arr) {
        Ok((h, _)) => h,
        Err(_) => return false,
    };

    computed.ct_eq(stored_hash).into()
}

/// Helper function to generate, hash, and persist a recovery code row for a user.
/// Returns the plaintext code to the caller.
pub async fn persist_for_user(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<String, RecoveryCodeError> {
    let code = generate();
    let (code_hash, code_salt) = hash(&code)?;

    let mut id_bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut id_bytes);
    let id = format!(
        "rc_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(id_bytes)
    );

    sqlx::query(
        "INSERT INTO recovery_codes (id, user_id, code_hash, code_salt) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(&code_hash[..])
    .bind(&code_salt[..])
    .execute(pool)
    .await?;

    Ok(code)
}

/// Helper function to verify a presented code against all unconsumed rows for a user.
/// Does not short-circuit to avoid timing leaks, returning the matching row ID if found.
pub async fn verify_for_user(
    pool: &SqlitePool,
    user_id: &str,
    presented_code: &str,
) -> Result<Option<String>, RecoveryCodeError> {
    let rows = sqlx::query(
        "SELECT id, code_hash, code_salt FROM recovery_codes WHERE user_id = ? AND consumed_at IS NULL ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut matched_id: Option<String> = None;

    for row in rows {
        let id: String = row.get("id");
        let stored_hash: Vec<u8> = row.get("code_hash");
        let stored_salt: Vec<u8> = row.get("code_salt");

        let matches = verify(presented_code, &stored_hash, &stored_salt);
        if matches {
            matched_id = Some(id);
        }
    }

    Ok(matched_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_format_and_alphabet() {
        let code = generate();
        assert_eq!(code.len(), RECOVERY_CODE_LENGTH);
        for ch in code.chars() {
            assert!(
                CROCKFORD_ALPHABET.contains(&(ch as u8)),
                "Invalid character in code: {}",
                ch
            );
        }
    }

    #[test]
    fn test_generated_codes_uniqueness() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        for _ in 0..1000 {
            let code = generate();
            assert!(set.insert(code), "Duplicate code generated!");
        }
    }

    #[test]
    fn test_hash_stability() {
        let code = "A1B2C3D4E5F6G7H8J9K0";
        let salt = [42u8; ARGON2_SALT_LEN];

        let (hash1, salt1) = hash_with_salt(code, &salt).unwrap();
        let (hash2, salt2) = hash_with_salt(code, &salt).unwrap();

        assert_eq!(hash1, hash2);
        assert_eq!(salt1, salt2);
    }

    #[test]
    fn test_hash_different_salts() {
        let code = "A1B2C3D4E5F6G7H8J9K0";
        let salt1 = [1u8; ARGON2_SALT_LEN];
        let salt2 = [2u8; ARGON2_SALT_LEN];

        let (hash1, _) = hash_with_salt(code, &salt1).unwrap();
        let (hash2, _) = hash_with_salt(code, &salt2).unwrap();

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_verify_success() {
        let code = generate();
        let (code_hash, code_salt) = hash(&code).unwrap();

        assert!(verify(&code, &code_hash, &code_salt));
    }

    #[test]
    fn test_verify_failures() {
        let code = generate();
        let (code_hash, code_salt) = hash(&code).unwrap();

        // Wrong code same length
        let wrong_code = generate();
        assert!(!verify(&wrong_code, &code_hash, &code_salt));

        // Wrong code different length
        assert!(!verify("SHORT", &code_hash, &code_salt));

        // Empty code
        assert!(!verify("", &code_hash, &code_salt));

        // Malformed salt or hash lengths
        assert!(!verify(&code, &code_hash, &[0u8; 10]));
        assert!(!verify(&code, &[0u8; 10], &code_salt));
    }
}
