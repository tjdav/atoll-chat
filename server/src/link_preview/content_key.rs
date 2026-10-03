use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tracing::info;
use x25519_dalek::{PublicKey, StaticSecret};

pub fn decode_base64_flexible(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
    STANDARD
        .decode(s)
        .or_else(|_| STANDARD_NO_PAD.decode(s))
        .or_else(|_| URL_SAFE.decode(s))
        .or_else(|_| URL_SAFE_NO_PAD.decode(s))
}

pub struct LinkPreviewKeys {
    pub secret_key: StaticSecret,
    pub public_key: PublicKey,
    pub public_key_base64: String,
}

impl LinkPreviewKeys {
    pub fn load_or_generate(key_path: &str) -> anyhow::Result<Self> {
        let path = Path::new(key_path);
        let secret_bytes = if path.exists() {
            let bytes = fs::read(path)?;
            if bytes.len() != 32 {
                anyhow::bail!(
                    "Invalid link preview key length in {}: expected 32 bytes, got {}",
                    key_path,
                    bytes.len()
                );
            }
            let mut array = [0u8; 32];
            array.copy_from_slice(&bytes);
            array
        } else {
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)?;
                }
            }
            let mut secret_bytes = [0u8; 32];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut secret_bytes);
            fs::write(path, secret_bytes)?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
            }
            info!("Generated new link preview X25519 key at {}", key_path);
            secret_bytes
        };

        let secret_key = StaticSecret::from(secret_bytes);
        let public_key = PublicKey::from(&secret_key);
        let public_key_base64 = BASE64.encode(public_key.as_bytes());

        Ok(Self {
            secret_key,
            public_key,
            public_key_base64,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestEnvelope {
    pub ephemeral_pubkey: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseEnvelope {
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestPlaintext {
    pub url: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponsePlaintext {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorPlaintext {
    pub error: String,
    pub request_id: Option<String>,
}

pub fn derive_content_key(
    server_secret: &StaticSecret,
    ephemeral_pubkey_bytes: &[u8; 32],
) -> anyhow::Result<[u8; 32]> {
    let client_pubkey = PublicKey::from(*ephemeral_pubkey_bytes);
    let shared_secret = server_secret.diffie_hellman(&client_pubkey);

    let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());
    let mut content_key = [0u8; 32];
    hk.expand(b"link-preview-content-key-v1", &mut content_key)
        .map_err(|_| anyhow::anyhow!("HKDF expand failed for link preview content key"))?;
    Ok(content_key)
}

pub fn decrypt_payload(
    content_key: &[u8; 32],
    nonce_bytes: &[u8; 12],
    ciphertext: &[u8],
) -> anyhow::Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(content_key)
        .map_err(|_| anyhow::anyhow!("Failed to initialize Aes256Gcm"))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("Decryption failed"))?;
    Ok(plaintext)
}

pub fn encrypt_payload(
    content_key: &[u8; 32],
    nonce_bytes: &[u8; 12],
    plaintext: &[u8],
) -> anyhow::Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(content_key)
        .map_err(|_| anyhow::anyhow!("Failed to initialize Aes256Gcm"))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| anyhow::anyhow!("Encryption failed"))?;
    Ok(ciphertext)
}
