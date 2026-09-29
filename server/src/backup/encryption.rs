use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::BackupError;

pub struct BackupKey([u8; 32]);

impl BackupKey {
    /// Derives the backup key from the OPRF key file's contents.
    pub fn derive(oprf_key_bytes: &[u8]) -> Result<Self, BackupError> {
        let prk = Sha256::digest(oprf_key_bytes);
        let hk = Hkdf::<Sha256>::new(None, &prk);
        let mut okm = [0u8; 32];
        hk.expand(b"backup-encryption-v1", &mut okm)
            .map_err(|e| BackupError::KeyDerivation(e.to_string()))?;
        Ok(BackupKey(okm))
    }

    pub fn inner(&self) -> &[u8; 32] {
        &self.0
    }
}

pub fn encrypt_backup(key: &BackupKey, plaintext: &[u8]) -> Result<Vec<u8>, BackupError> {
    let cipher = Aes256Gcm::new_from_slice(key.inner())
        .map_err(|e| BackupError::Encryption(e.to_string()))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext_and_tag = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| BackupError::Encryption(e.to_string()))?;

    let mut out = Vec::with_capacity(12 + ciphertext_and_tag.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext_and_tag);
    Ok(out)
}

pub fn decrypt_backup(key: &BackupKey, ciphertext: &[u8]) -> Result<Vec<u8>, BackupError> {
    if ciphertext.len() < 12 + 16 {
        return Err(BackupError::InvalidFormat(
            "ciphertext too short".to_string(),
        ));
    }

    let (nonce_bytes, ciphertext_and_tag) = ciphertext.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key.inner())
        .map_err(|e| BackupError::Decryption(e.to_string()))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext_and_tag)
        .map_err(|e| BackupError::Decryption(e.to_string()))?;

    Ok(plaintext)
}
