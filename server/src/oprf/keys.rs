use hkdf::Hkdf;
use opaque_ke::ServerSetup;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use voprf::{OprfServer, Ristretto255};

use crate::DefaultCipherSuite;

#[derive(Debug, thiserror::Error)]
pub enum OprfError {
    #[error("serialization failed: {0}")]
    Serialization(String),
    #[error("key construction failed: {0}")]
    KeyConstruction(String),
    #[error("evaluation failed: {0}")]
    Evaluation(String),
    #[error("invalid blinded element: {0}")]
    InvalidBlindedElement(String),
}

pub struct OprfKeys {
    pub username_server: Arc<OprfServer<Ristretto255>>,
}

impl OprfKeys {
    /// Derives the username OPRF key from the serialized ServerSetup file.
    ///
    /// This does NOT re-generate the ServerSetup. It reads the existing
    /// file (which may have been created by V1's Phase 3a or by this
    /// version on first startup) and derives the OPRF key from it.
    pub fn load(setup: &ServerSetup<DefaultCipherSuite>) -> Result<Self, OprfError> {
        let serialized_bytes = setup.serialize();
        let root_secret = Sha256::digest(serialized_bytes);

        let hk = Hkdf::<Sha256>::new(None, &root_secret);
        let mut username_key = [0u8; 32];
        hk.expand(b"username-oprf-v1", &mut username_key)
            .map_err(|e| OprfError::KeyConstruction(e.to_string()))?;

        let server = OprfServer::<Ristretto255>::new_from_seed(&username_key, b"username-oprf-v1")
            .map_err(|e| OprfError::KeyConstruction(e.to_string()))?;

        Ok(Self {
            username_server: Arc::new(server),
        })
    }
}
