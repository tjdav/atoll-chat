use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use std::sync::Arc;
use voprf::{BlindedElement, OprfServer, Ristretto255};

use super::keys::{OprfError, OprfKeys};

pub struct OprfEvaluator {
    server: Arc<OprfServer<Ristretto255>>,
}

impl OprfEvaluator {
    pub fn new(keys: &OprfKeys) -> Self {
        Self {
            server: keys.username_server.clone(),
        }
    }

    /// Evaluates a blinded element.
    ///
    /// The input is a base64-encoded 32-byte compressed Ristretto255 point.
    /// The output is a base64-encoded 32-byte compressed Ristretto255 point.
    pub fn evaluate_blinded(&self, blinded_b64: &str) -> Result<String, OprfError> {
        let bytes = STANDARD
            .decode(blinded_b64)
            .or_else(|_| URL_SAFE_NO_PAD.decode(blinded_b64))
            .or_else(|_| URL_SAFE.decode(blinded_b64))
            .map_err(|e| OprfError::InvalidBlindedElement(e.to_string()))?;

        if bytes.len() != 32 {
            return Err(OprfError::InvalidBlindedElement(format!(
                "expected 32 bytes, got {}",
                bytes.len()
            )));
        }

        // Parse as BlindedElement<Ristretto255> using voprf's deserialize method.
        // voprf 0.5.0 provides BlindedElement::deserialize(&bytes) which validates
        // and reconstructs the compressed Ristretto255 group element.
        let blinded_element = BlindedElement::<Ristretto255>::deserialize(&bytes)
            .map_err(|e| OprfError::InvalidBlindedElement(e.to_string()))?;

        let eval_element = self.server.blind_evaluate(&blinded_element);
        let eval_bytes = eval_element.serialize();

        Ok(STANDARD.encode(eval_bytes))
    }
}
