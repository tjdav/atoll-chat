use ed25519_dalek::{SigningKey, VerifyingKey};
use hkdf::Hkdf;
use opaque_ke::ServerSetup;
use sha2::{Digest, Sha256};

use crate::DefaultCipherSuite;

#[derive(Debug, thiserror::Error)]
pub enum SigningKeyError {
    #[error("key construction failed: {0}")]
    KeyConstruction(String),
}

pub struct KeyTransparencyKeys {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
}

impl KeyTransparencyKeys {
    /// Derives the Key Transparency Ed25519 signing key pair from the serialized ServerSetup file (Option A).
    ///
    /// Derivation formula:
    ///   root_secret    = SHA-256(oprf_key_bytes)
    ///   kt_signing_seed = HKDF-Expand(root_secret, info="key-transparency-signing-v1", length=32)
    pub fn derive(setup: &ServerSetup<DefaultCipherSuite>) -> Result<Self, SigningKeyError> {
        let serialized_bytes = setup.serialize();
        let root_secret = Sha256::digest(serialized_bytes);

        let hk = Hkdf::<Sha256>::new(None, &root_secret);
        let mut seed = [0u8; 32];
        hk.expand(b"key-transparency-signing-v1", &mut seed)
            .map_err(|e| SigningKeyError::KeyConstruction(e.to_string()))?;

        let signing_key = SigningKey::from_bytes(&seed);
        let verifying_key = signing_key.verifying_key();

        Ok(Self {
            signing_key,
            verifying_key,
        })
    }
}
