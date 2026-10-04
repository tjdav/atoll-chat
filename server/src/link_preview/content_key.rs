pub use crate::proxy_common::content_key::{
    decode_base64_flexible, decrypt_payload, encrypt_payload, ErrorPlaintext,
    ProxyKeys as LinkPreviewKeys, RequestEnvelope, ResponseEnvelope,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use x25519_dalek::StaticSecret;

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

pub fn derive_content_key(
    server_secret: &StaticSecret,
    ephemeral_pubkey_bytes: &[u8; 32],
) -> anyhow::Result<[u8; 32]> {
    crate::proxy_common::content_key::derive_content_key(
        server_secret,
        ephemeral_pubkey_bytes,
        b"link-preview-content-key-v1",
    )
}
