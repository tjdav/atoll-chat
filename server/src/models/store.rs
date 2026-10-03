use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tracing::{info, warn};

use super::manifest::{
    load_manifest, load_voices_config, ManifestError, ModelEntry, ModelFile, ModelManifest,
    TtsVoiceConfig, VoiceMetadata,
};

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

#[derive(Debug, Clone)]
pub struct ModelStore {
    inner: Arc<RwLock<LoadedManifests>>,
    stt_models_path: PathBuf,
    tts_models_path: PathBuf,
}

impl ModelStore {
    pub fn new(stt_models_path: PathBuf, tts_models_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(RwLock::new(LoadedManifests::empty())),
            stt_models_path,
            tts_models_path,
        }
    }

    pub fn load_initial(&self) {
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

    pub fn reload(&self) -> Result<(usize, usize), (String, ManifestError)> {
        let stt_manifest_path = self.stt_models_path.join("manifest.json");
        let tts_manifest_path = self.tts_models_path.join("manifest.json");

        let stt = match load_manifest(&stt_manifest_path) {
            Ok(m) => Some(m),
            Err(e) => {
                return Err(("stt".to_string(), e));
            }
        };

        let (tts, tts_voices) = match load_manifest(&tts_manifest_path) {
            Ok(m) => {
                let mut voices_map = HashMap::new();
                for model in &m.models {
                    let v_cfg = load_voices_config(&self.tts_models_path, &model.id, model.version);
                    voices_map.insert((model.id.clone(), model.version), v_cfg);
                }
                (Some(m), voices_map)
            }
            Err(e) => {
                return Err(("tts".to_string(), e));
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

    pub fn stt_models(&self) -> Vec<ModelEntry> {
        self.inner
            .read()
            .ok()
            .and_then(|g| g.stt.as_ref().map(|m| m.models.clone()))
            .unwrap_or_default()
    }

    pub fn tts_models(&self) -> Vec<ModelEntry> {
        self.inner
            .read()
            .ok()
            .and_then(|g| g.tts.as_ref().map(|m| m.models.clone()))
            .unwrap_or_default()
    }

    pub fn tts_capability_models(&self) -> Vec<TtsCapabilityModelView> {
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

    pub fn find_stt_file(&self, model_id: &str, version: u32, filename: &str) -> Option<ModelFile> {
        let guard = self.inner.read().ok()?;
        let stt_manifest = guard.stt.as_ref()?;
        let model = stt_manifest
            .models
            .iter()
            .find(|m| m.id == model_id && m.version == version)?;
        model.files.iter().find(|f| f.name == filename).cloned()
    }

    pub fn find_tts_file(&self, model_id: &str, version: u32, filename: &str) -> Option<ModelFile> {
        let guard = self.inner.read().ok()?;
        let tts_manifest = guard.tts.as_ref()?;
        let model = tts_manifest
            .models
            .iter()
            .find(|m| m.id == model_id && m.version == version)?;
        model.files.iter().find(|f| f.name == filename).cloned()
    }

    pub fn stt_models_path(&self) -> &Path {
        &self.stt_models_path
    }

    pub fn tts_models_path(&self) -> &Path {
        &self.tts_models_path
    }
}
