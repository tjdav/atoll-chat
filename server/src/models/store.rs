use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tracing::{info, warn};

use super::cache::{ExternalCacheError, ExternalManifestCache};
use super::manifest::{
    load_manifest, load_voices_config, ModelEntry, ModelFile, ModelManifest, TtsVoiceConfig,
    VoiceMetadata,
};
use super::mode::ModelHostingMode;

const FILE_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const FILE_READ_TIMEOUT: Duration = Duration::from_secs(60);
const FAILURE_CACHE_TTL: Duration = Duration::from_secs(30);

type FailureCacheKey = (String, u32, String);
type FailureCache = Arc<RwLock<HashMap<FailureCacheKey, Instant>>>;

#[derive(Debug, Clone, Serialize)]
pub struct TtsCapabilityModelView {
    pub id: String,
    pub version: u32,
    pub size_bytes: u64,
    pub languages: Vec<String>,
    pub voices: Vec<VoiceMetadata>,
}

#[derive(Debug, Clone)]
pub struct LoadedManifests {
    pub stt: Option<ModelManifest>,
    pub tts: Option<ModelManifest>,
    pub tts_voices: HashMap<(String, u32), TtsVoiceConfig>,
}

impl LoadedManifests {
    pub fn empty() -> Self {
        Self {
            stt: None,
            tts: None,
            tts_voices: HashMap::new(),
        }
    }
}

#[derive(Debug)]
pub enum ModelReloadError {
    LocalValidation {
        kind: String,
        path: PathBuf,
        reason: String,
    },
    ExternalNetwork {
        url: String,
        reason: String,
    },
    ExternalValidation {
        url: String,
        reason: String,
    },
}

impl std::fmt::Display for ModelReloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModelReloadError::LocalValidation { kind, path, reason } => {
                write!(
                    f,
                    "Local manifest error for {} at {:?}: {}",
                    kind, path, reason
                )
            }
            ModelReloadError::ExternalNetwork { url, reason } => {
                write!(
                    f,
                    "Network error fetching external manifest from {}: {}",
                    url, reason
                )
            }
            ModelReloadError::ExternalValidation { url, reason } => {
                write!(
                    f,
                    "Validation error for external manifest from {}: {}",
                    url, reason
                )
            }
        }
    }
}

impl std::error::Error for ModelReloadError {}

#[derive(Debug)]
pub enum ProxyFetchError {
    NotFound,
    UpstreamFailed(String),
    SizeMismatch { expected: u64, got: u64 },
    HashMismatch { expected: String, got: String },
    Io(std::io::Error),
}

impl std::fmt::Display for ProxyFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProxyFetchError::NotFound => write!(f, "Model file not found in manifest"),
            ProxyFetchError::UpstreamFailed(msg) => write!(f, "Upstream fetch failed: {}", msg),
            ProxyFetchError::SizeMismatch { expected, got } => {
                write!(f, "File size mismatch: expected {}, got {}", expected, got)
            }
            ProxyFetchError::HashMismatch { expected, got } => {
                write!(f, "SHA-256 mismatch: expected {}, got {}", expected, got)
            }
            ProxyFetchError::Io(err) => write!(f, "IO error: {}", err),
        }
    }
}

impl std::error::Error for ProxyFetchError {}

#[derive(Debug, Clone)]
pub struct ModelStore {
    inner: Arc<RwLock<LoadedManifests>>,
    mode: ModelHostingMode,
    stt_models_path: PathBuf,
    tts_models_path: PathBuf,
    external_base_url: Option<String>,
    external_cache: Option<Arc<ExternalManifestCache>>,
    http_client: reqwest::Client,
    failure_cache: FailureCache,
}

impl ModelStore {
    pub fn new(stt_models_path: PathBuf, tts_models_path: PathBuf) -> Self {
        Self::new_with_mode(
            ModelHostingMode::Local,
            stt_models_path,
            tts_models_path,
            None,
        )
    }

    pub fn new_with_mode(
        mode: ModelHostingMode,
        stt_models_path: PathBuf,
        tts_models_path: PathBuf,
        external_base_url: Option<String>,
    ) -> Self {
        let external_cache = external_base_url
            .as_ref()
            .map(|url| Arc::new(ExternalManifestCache::new(url.clone())));

        let http_client = reqwest::Client::builder()
            .connect_timeout(FILE_CONNECT_TIMEOUT)
            .timeout(FILE_READ_TIMEOUT)
            .build()
            .unwrap_or_default();

        Self {
            inner: Arc::new(RwLock::new(LoadedManifests::empty())),
            mode,
            stt_models_path,
            tts_models_path,
            external_base_url,
            external_cache,
            http_client,
            failure_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn mode(&self) -> ModelHostingMode {
        self.mode
    }

    pub fn external_base_url(&self) -> Option<&str> {
        self.external_base_url.as_deref()
    }

    pub fn external_cache(&self) -> Option<&Arc<ExternalManifestCache>> {
        self.external_cache.as_ref()
    }

    pub fn load_initial(&self) {
        if self.mode == ModelHostingMode::External {
            return;
        }

        let stt_manifest_path = self.stt_models_path.join("manifest.json");
        let tts_manifest_path = self.tts_models_path.join("manifest.json");

        let stt = match load_manifest(&stt_manifest_path) {
            Ok(m) => {
                info!("Loaded STT model manifest from {:?}", stt_manifest_path);
                Some(m)
            }
            Err(e) => {
                warn!(
                    "Failed to load STT model manifest from {:?}: {}",
                    stt_manifest_path, e
                );
                None
            }
        };

        let (tts, tts_voices) = match load_manifest(&tts_manifest_path) {
            Ok(m) => {
                info!("Loaded TTS model manifest from {:?}", tts_manifest_path);
                let mut voices_map = HashMap::new();
                for model in &m.models {
                    let v_cfg = load_voices_config(&self.tts_models_path, &model.id, model.version);
                    voices_map.insert((model.id.clone(), model.version), v_cfg);
                }
                (Some(m), voices_map)
            }
            Err(e) => {
                warn!(
                    "Failed to load TTS model manifest from {:?}: {}",
                    tts_manifest_path, e
                );
                (None, HashMap::new())
            }
        };

        if let Ok(mut guard) = self.inner.write() {
            *guard = LoadedManifests {
                stt,
                tts,
                tts_voices,
            };
        }
    }

    pub async fn reload(&self) -> Result<(usize, usize), ModelReloadError> {
        if self.mode == ModelHostingMode::External {
            let cache =
                self.external_cache
                    .as_ref()
                    .ok_or_else(|| ModelReloadError::ExternalNetwork {
                        url: "none".to_string(),
                        reason: "External cache unconfigured".to_string(),
                    })?;

            let ext_url = self.external_base_url.as_deref().unwrap_or("unknown");
            let cached = cache.fetch_manifest(true).await.map_err(|e| match e {
                ExternalCacheError::Network(msg) => ModelReloadError::ExternalNetwork {
                    url: ext_url.to_string(),
                    reason: msg,
                },
                ExternalCacheError::Validation(msg) => ModelReloadError::ExternalValidation {
                    url: ext_url.to_string(),
                    reason: msg,
                },
            })?;

            Ok((cached.stt.models.len(), cached.tts.models.len()))
        } else {
            let stt_manifest_path = self.stt_models_path.join("manifest.json");
            let tts_manifest_path = self.tts_models_path.join("manifest.json");

            let stt = match load_manifest(&stt_manifest_path) {
                Ok(m) => Some(m),
                Err(e) => {
                    return Err(ModelReloadError::LocalValidation {
                        kind: "stt".to_string(),
                        path: stt_manifest_path,
                        reason: e.to_string(),
                    });
                }
            };

            let (tts, tts_voices) = match load_manifest(&tts_manifest_path) {
                Ok(m) => {
                    let mut voices_map = HashMap::new();
                    for model in &m.models {
                        let v_cfg =
                            load_voices_config(&self.tts_models_path, &model.id, model.version);
                        voices_map.insert((model.id.clone(), model.version), v_cfg);
                    }
                    (Some(m), voices_map)
                }
                Err(e) => {
                    return Err(ModelReloadError::LocalValidation {
                        kind: "tts".to_string(),
                        path: tts_manifest_path,
                        reason: e.to_string(),
                    });
                }
            };

            let stt_count = stt.as_ref().map(|m| m.models.len()).unwrap_or(0);
            let tts_count = tts.as_ref().map(|m| m.models.len()).unwrap_or(0);

            if let Ok(mut guard) = self.inner.write() {
                *guard = LoadedManifests {
                    stt,
                    tts,
                    tts_voices,
                };
            }

            Ok((stt_count, tts_count))
        }
    }

    pub fn stt_models(&self) -> Vec<ModelEntry> {
        if self.mode == ModelHostingMode::External {
            if let Some(cache) = &self.external_cache {
                if let Some(c) = cache.get_any_cached() {
                    return c.stt.models;
                }
            }
            Vec::new()
        } else {
            self.inner
                .read()
                .ok()
                .and_then(|g| g.stt.as_ref().map(|m| m.models.clone()))
                .unwrap_or_default()
        }
    }

    pub fn tts_models(&self) -> Vec<ModelEntry> {
        if self.mode == ModelHostingMode::External {
            if let Some(cache) = &self.external_cache {
                if let Some(c) = cache.get_any_cached() {
                    return c.tts.models;
                }
            }
            Vec::new()
        } else {
            self.inner
                .read()
                .ok()
                .and_then(|g| g.tts.as_ref().map(|m| m.models.clone()))
                .unwrap_or_default()
        }
    }

    pub fn tts_capability_models(&self) -> Vec<TtsCapabilityModelView> {
        if self.mode == ModelHostingMode::External {
            if let Some(cache) = &self.external_cache {
                if let Some(c) = cache.get_any_cached() {
                    return c
                        .tts
                        .models
                        .iter()
                        .map(|model| {
                            let default_cfg = TtsVoiceConfig::default();
                            let v_cfg = c
                                .tts_voices
                                .get(&(model.id.clone(), model.version))
                                .unwrap_or(&default_cfg);

                            TtsCapabilityModelView {
                                id: model.id.clone(),
                                version: model.version,
                                size_bytes: model.size_bytes,
                                languages: v_cfg.languages.clone(),
                                voices: v_cfg.voices.clone(),
                            }
                        })
                        .collect();
                }
            }
            Vec::new()
        } else {
            let guard = match self.inner.read() {
                Ok(g) => g,
                Err(_) => return Vec::new(),
            };

            let tts_manifest = match &guard.tts {
                Some(m) => m,
                None => return Vec::new(),
            };

            tts_manifest
                .models
                .iter()
                .map(|model| {
                    let default_cfg = TtsVoiceConfig::default();
                    let v_cfg = guard
                        .tts_voices
                        .get(&(model.id.clone(), model.version))
                        .unwrap_or(&default_cfg);

                    TtsCapabilityModelView {
                        id: model.id.clone(),
                        version: model.version,
                        size_bytes: model.size_bytes,
                        languages: v_cfg.languages.clone(),
                        voices: v_cfg.voices.clone(),
                    }
                })
                .collect()
        }
    }

    pub fn find_stt_file(&self, model_id: &str, version: u32, filename: &str) -> Option<ModelFile> {
        if self.mode == ModelHostingMode::External {
            if let Some(cache) = &self.external_cache {
                if let Some(c) = cache.get_any_cached() {
                    let model = c
                        .stt
                        .models
                        .iter()
                        .find(|m| m.id == model_id && m.version == version)?;
                    return model.files.iter().find(|f| f.name == filename).cloned();
                }
            }
            None
        } else {
            let guard = self.inner.read().ok()?;
            let stt_manifest = guard.stt.as_ref()?;
            let model = stt_manifest
                .models
                .iter()
                .find(|m| m.id == model_id && m.version == version)?;
            model.files.iter().find(|f| f.name == filename).cloned()
        }
    }

    pub fn find_tts_file(&self, model_id: &str, version: u32, filename: &str) -> Option<ModelFile> {
        if self.mode == ModelHostingMode::External {
            if let Some(cache) = &self.external_cache {
                if let Some(c) = cache.get_any_cached() {
                    let model = c
                        .tts
                        .models
                        .iter()
                        .find(|m| m.id == model_id && m.version == version)?;
                    return model.files.iter().find(|f| f.name == filename).cloned();
                }
            }
            None
        } else {
            let guard = self.inner.read().ok()?;
            let tts_manifest = guard.tts.as_ref()?;
            let model = tts_manifest
                .models
                .iter()
                .find(|m| m.id == model_id && m.version == version)?;
            model.files.iter().find(|f| f.name == filename).cloned()
        }
    }

    pub fn stt_models_path(&self) -> &Path {
        &self.stt_models_path
    }

    pub fn tts_models_path(&self) -> &Path {
        &self.tts_models_path
    }

    pub async fn ensure_model_file(
        &self,
        kind: &str,
        model_id: &str,
        version: u32,
        filename: &str,
    ) -> Result<PathBuf, ProxyFetchError> {
        let base_dir = if kind == "stt" {
            &self.stt_models_path
        } else {
            &self.tts_models_path
        };

        let dir_path = base_dir.join(model_id).join(version.to_string());
        let file_path = dir_path.join(filename);

        if file_path.exists() {
            return Ok(file_path);
        }

        if self.mode != ModelHostingMode::Proxy {
            return Err(ProxyFetchError::NotFound);
        }

        let cache_key = (model_id.to_string(), version, filename.to_string());
        if let Ok(guard) = self.failure_cache.read() {
            if let Some(failed_at) = guard.get(&cache_key) {
                if failed_at.elapsed() < FAILURE_CACHE_TTL {
                    return Err(ProxyFetchError::UpstreamFailed(
                        "Recent failure cached".to_string(),
                    ));
                }
            }
        }

        let ext_base = match &self.external_base_url {
            Some(url) => url.trim_end_matches('/'),
            None => {
                return Err(ProxyFetchError::UpstreamFailed(
                    "No external base URL".to_string(),
                ))
            }
        };

        let model_file = match if kind == "stt" {
            self.find_stt_file(model_id, version, filename)
        } else {
            self.find_tts_file(model_id, version, filename)
        } {
            Some(f) => f,
            None => return Err(ProxyFetchError::NotFound),
        };

        let upstream_url = format!(
            "{}/{}/v1/{}/{}/{}",
            ext_base, kind, model_id, version, filename
        );

        tokio::fs::create_dir_all(&dir_path)
            .await
            .map_err(ProxyFetchError::Io)?;

        let temp_filename = format!(
            "{}.tmp.{}.{}",
            filename,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let temp_path = dir_path.join(temp_filename);

        let fetch_result = self
            .download_and_verify(&upstream_url, &temp_path, &model_file)
            .await;

        match fetch_result {
            Ok(()) => {
                if let Err(e) = tokio::fs::rename(&temp_path, &file_path).await {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    self.record_failure(cache_key);
                    return Err(ProxyFetchError::Io(e));
                }
                info!(
                    model_id = %model_id,
                    version = %version,
                    filename = %filename,
                    "Successfully fetched and cached model file in proxy mode"
                );
                Ok(file_path)
            }
            Err(err) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                self.record_failure(cache_key);
                warn!(
                    model_id = %model_id,
                    version = %version,
                    filename = %filename,
                    error = %err,
                    "Failed to fetch model file in proxy mode"
                );
                Err(err)
            }
        }
    }

    fn record_failure(&self, key: (String, u32, String)) {
        if let Ok(mut guard) = self.failure_cache.write() {
            guard.insert(key, Instant::now());
        }
    }

    async fn download_and_verify(
        &self,
        url: &str,
        temp_path: &Path,
        model_file: &ModelFile,
    ) -> Result<(), ProxyFetchError> {
        let mut res = self
            .http_client
            .get(url)
            .send()
            .await
            .map_err(|e| ProxyFetchError::UpstreamFailed(e.to_string()))?;

        if !res.status().is_success() {
            return Err(ProxyFetchError::UpstreamFailed(format!(
                "HTTP status {}",
                res.status()
            )));
        }

        let mut file = tokio::fs::File::create(temp_path)
            .await
            .map_err(ProxyFetchError::Io)?;

        let mut hasher = Sha256::new();
        let mut total_bytes: u64 = 0;

        while let Some(chunk) = res
            .chunk()
            .await
            .map_err(|e| ProxyFetchError::UpstreamFailed(e.to_string()))?
        {
            total_bytes += chunk.len() as u64;
            hasher.update(&chunk);
            file.write_all(&chunk).await.map_err(ProxyFetchError::Io)?;
        }

        file.flush().await.map_err(ProxyFetchError::Io)?;
        drop(file);

        if total_bytes != model_file.size_bytes {
            return Err(ProxyFetchError::SizeMismatch {
                expected: model_file.size_bytes,
                got: total_bytes,
            });
        }

        let actual_sha256 = format!("{:x}", hasher.finalize());
        if actual_sha256.to_lowercase() != model_file.sha256.to_lowercase() {
            return Err(ProxyFetchError::HashMismatch {
                expected: model_file.sha256.clone(),
                got: actual_sha256,
            });
        }

        Ok(())
    }
}
