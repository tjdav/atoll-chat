use serde::Deserialize;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};
use tracing::info;

use super::manifest::{
    parse_and_validate_manifest, ManifestError, ModelEntry, ModelManifest, TtsVoiceConfig,
    VoiceMetadata,
};

const MANIFEST_TTL: Duration = Duration::from_secs(3600);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub enum ExternalCacheError {
    Network(String),
    Validation(String),
}

impl std::fmt::Display for ExternalCacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExternalCacheError::Network(msg) => write!(f, "Network error: {}", msg),
            ExternalCacheError::Validation(msg) => write!(f, "Validation error: {}", msg),
        }
    }
}

impl std::error::Error for ExternalCacheError {}

#[derive(Debug, Clone)]
pub struct CachedManifest {
    pub stt: ModelManifest,
    pub tts: ModelManifest,
    pub tts_voices: HashMap<(String, u32), TtsVoiceConfig>,
    pub fetched_at: Instant,
}

#[derive(Debug)]
pub struct ExternalManifestCache {
    external_base_url: String,
    client: reqwest::Client,
    cached: RwLock<Option<CachedManifest>>,
}

impl ExternalManifestCache {
    pub fn new(external_base_url: String) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(READ_TIMEOUT)
            .build()
            .unwrap_or_default();

        Self {
            external_base_url,
            client,
            cached: RwLock::new(None),
        }
    }

    pub fn get_cached(&self) -> Option<CachedManifest> {
        let guard = self.cached.read().ok()?;
        let cached = guard.as_ref()?;
        if cached.fetched_at.elapsed() < MANIFEST_TTL {
            Some(cached.clone())
        } else {
            None
        }
    }

    pub fn get_any_cached(&self) -> Option<CachedManifest> {
        let guard = self.cached.read().ok()?;
        guard.clone()
    }

    pub async fn fetch_manifest(
        &self,
        force_reload: bool,
    ) -> Result<CachedManifest, ExternalCacheError> {
        if !force_reload {
            if let Some(cached) = self.get_cached() {
                return Ok(cached);
            }
        }

        let base_url = self.external_base_url.trim_end_matches('/');
        let manifest_url = format!("{}/manifest.json", base_url);

        let res = self
            .client
            .get(&manifest_url)
            .send()
            .await
            .map_err(|e| ExternalCacheError::Network(e.to_string()))?;

        if !res.status().is_success() {
            return Err(ExternalCacheError::Network(format!(
                "HTTP {}",
                res.status()
            )));
        }

        let body = res
            .text()
            .await
            .map_err(|e| ExternalCacheError::Network(e.to_string()))?;

        let (stt, tts, tts_voices) = parse_external_manifest(&body)
            .map_err(|e| ExternalCacheError::Validation(e.to_string()))?;

        let new_cached = CachedManifest {
            stt,
            tts,
            tts_voices,
            fetched_at: Instant::now(),
        };

        if let Ok(mut guard) = self.cached.write() {
            *guard = Some(new_cached.clone());
        }

        info!("Successfully fetched and cached external model manifest");
        Ok(new_cached)
    }
}

#[derive(Deserialize)]
struct RawModelWithVoice {
    #[serde(flatten)]
    pub entry: ModelEntry,
    #[serde(default)]
    pub languages: Option<Vec<String>>,
    #[serde(default)]
    pub voices: Option<Vec<VoiceMetadata>>,
}

#[derive(Deserialize)]
struct RawManifestPart {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub models: Vec<RawModelWithVoice>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Deserialize)]
struct RawCombinedManifest {
    pub stt: Option<RawManifestPart>,
    pub tts: Option<RawManifestPart>,
    pub schema_version: Option<u32>,
    pub models: Option<Vec<RawModelWithVoice>>,
}

pub type ParsedExternalManifest = (
    ModelManifest,
    ModelManifest,
    HashMap<(String, u32), TtsVoiceConfig>,
);

pub fn parse_external_manifest(body: &str) -> Result<ParsedExternalManifest, ManifestError> {
    let raw: RawCombinedManifest = serde_json::from_str(body)?;

    let mut tts_voices = HashMap::new();

    let (stt_raw, tts_raw) = match (raw.stt, raw.tts) {
        (Some(stt), Some(tts)) => (stt, tts),
        (Some(stt), None) => (
            stt,
            RawManifestPart {
                schema_version: 1,
                models: Vec::new(),
            },
        ),
        (None, Some(tts)) => (
            RawManifestPart {
                schema_version: 1,
                models: Vec::new(),
            },
            tts,
        ),
        (None, None) => {
            if let Some(models) = raw.models {
                let sv = raw.schema_version.unwrap_or(1);
                (
                    RawManifestPart {
                        schema_version: sv,
                        models,
                    },
                    RawManifestPart {
                        schema_version: 1,
                        models: Vec::new(),
                    },
                )
            } else {
                (
                    RawManifestPart {
                        schema_version: 1,
                        models: Vec::new(),
                    },
                    RawManifestPart {
                        schema_version: 1,
                        models: Vec::new(),
                    },
                )
            }
        }
    };

    let stt_manifest = build_and_validate_manifest(stt_raw.schema_version, &stt_raw.models)?;

    for m in &tts_raw.models {
        if m.languages.is_some() || m.voices.is_some() {
            let cfg = TtsVoiceConfig {
                languages: m.languages.clone().unwrap_or_else(|| vec!["*".to_string()]),
                voices: m.voices.clone().unwrap_or_default(),
            };
            tts_voices.insert((m.entry.id.clone(), m.entry.version), cfg);
        }
    }

    let tts_manifest = build_and_validate_manifest(tts_raw.schema_version, &tts_raw.models)?;

    Ok((stt_manifest, tts_manifest, tts_voices))
}

fn build_and_validate_manifest(
    schema_version: u32,
    raw_models: &[RawModelWithVoice],
) -> Result<ModelManifest, ManifestError> {
    let manifest = ModelManifest {
        schema_version,
        models: raw_models.iter().map(|m| m.entry.clone()).collect(),
    };

    let json_str = serde_json::to_string(&manifest)?;
    parse_and_validate_manifest(&json_str)
}
