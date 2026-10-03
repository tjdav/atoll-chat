use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFile {
    pub name: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    pub version: u32,
    pub size_bytes: u64,
    pub files: Vec<ModelFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelManifest {
    pub schema_version: u32,
    pub models: Vec<ModelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VoiceMetadata {
    pub id: String,
    pub language: String,
    pub gender: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsVoiceConfig {
    #[serde(default = "default_languages")]
    pub languages: Vec<String>,
    #[serde(default)]
    pub voices: Vec<VoiceMetadata>,
}

fn default_languages() -> Vec<String> {
    vec!["*".to_string()]
}

impl Default for TtsVoiceConfig {
    fn default() -> Self {
        Self {
            languages: default_languages(),
            voices: Vec::new(),
        }
    }
}

#[derive(thiserror::Error, Debug)]
pub enum ManifestError {
    #[error("manifest file not found at {path:?}")]
    FileNotFound { path: String },

    #[error("failed to read manifest file: {0}")]
    Io(#[from] std::io::Error),

    #[error("failed to parse manifest JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("invalid schema_version: expected 1, got {got}")]
    InvalidSchemaVersion { got: u32 },

    #[error("invalid model_id \"{id}\": must not be empty and must contain only [A-Za-z0-9._-]")]
    InvalidModelId { id: String },

    #[error("duplicate model id \"{id}\" in manifest")]
    DuplicateModelId { id: String },

    #[error("invalid version {version} for model \"{id}\": must be >= 1")]
    InvalidVersion { id: String, version: u32 },

    #[error("model \"{id}\" must have at least one file")]
    EmptyFiles { id: String },

    #[error("invalid filename \"{name}\" in model \"{id}\": must not be empty, contain path separators, or bytes outside [A-Za-z0-9._-]")]
    InvalidFilename { id: String, name: String },

    #[error("invalid sha256 \"{sha256}\" for file \"{name}\" in model \"{id}\": must be 64 hex characters")]
    InvalidSha256 {
        id: String,
        name: String,
        sha256: String,
    },
}

pub fn is_valid_filename(filename: &str) -> bool {
    if filename.is_empty() {
        return false;
    }
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return false;
    }
    filename
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

pub fn is_valid_model_id(id: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    id.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
}

fn is_valid_sha256(sha256: &str) -> bool {
    sha256.len() == 64 && sha256.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn parse_and_validate_manifest(content: &str) -> Result<ModelManifest, ManifestError> {
    let manifest: ModelManifest = serde_json::from_str(content)?;

    if manifest.schema_version != 1 {
        return Err(ManifestError::InvalidSchemaVersion {
            got: manifest.schema_version,
        });
    }

    let mut seen_ids = HashSet::new();

    for model in &manifest.models {
        if !is_valid_model_id(&model.id) {
            return Err(ManifestError::InvalidModelId {
                id: model.id.clone(),
            });
        }

        if !seen_ids.insert(&model.id) {
            return Err(ManifestError::DuplicateModelId {
                id: model.id.clone(),
            });
        }

        if model.version < 1 {
            return Err(ManifestError::InvalidVersion {
                id: model.id.clone(),
                version: model.version,
            });
        }

        if model.files.is_empty() {
            return Err(ManifestError::EmptyFiles {
                id: model.id.clone(),
            });
        }

        for file in &model.files {
            if !is_valid_filename(&file.name) {
                return Err(ManifestError::InvalidFilename {
                    id: model.id.clone(),
                    name: file.name.clone(),
                });
            }

            if !is_valid_sha256(&file.sha256) {
                return Err(ManifestError::InvalidSha256 {
                    id: model.id.clone(),
                    name: file.name.clone(),
                    sha256: file.sha256.clone(),
                });
            }
        }
    }

    Ok(manifest)
}

pub fn load_manifest(path: &Path) -> Result<ModelManifest, ManifestError> {
    if !path.exists() {
        return Err(ManifestError::FileNotFound {
            path: path.to_string_lossy().to_string(),
        });
    }

    let content = std::fs::read_to_string(path)?;
    parse_and_validate_manifest(&content)
}

pub fn load_voices_config(base_path: &Path, model_id: &str, version: u32) -> TtsVoiceConfig {
    let voices_path = base_path
        .join(model_id)
        .join(version.to_string())
        .join("voices.json");

    if !voices_path.exists() {
        return TtsVoiceConfig::default();
    }

    match std::fs::read_to_string(&voices_path) {
        Ok(content) => match serde_json::from_str::<TtsVoiceConfig>(&content) {
            Ok(cfg) => cfg,
            Err(e) => {
                warn!(
                    "Failed to parse voices.json at {:?}: {}. Using default voice config.",
                    voices_path, e
                );
                TtsVoiceConfig::default()
            }
        },
        Err(e) => {
            warn!(
                "Failed to read voices.json at {:?}: {}. Using default voice config.",
                voices_path, e
            );
            TtsVoiceConfig::default()
        }
    }
}
