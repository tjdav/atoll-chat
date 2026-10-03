use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{OnceLock, RwLock};

static TYPE_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_type_regex() -> &'static Regex {
    TYPE_REGEX.get_or_init(|| Regex::new(r"^[a-z][a-z0-9_-]*$").expect("valid static regex"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionType {
    pub r#type: String,
    pub extension_id: String,
    pub max_participants: u32,
    pub max_per_room: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionTypeCapView {
    pub extension_id: String,
    pub r#type: String,
    pub max_participants: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionTypeAdminView {
    pub r#type: String,
    pub extension_id: String,
    pub max_participants: u32,
    pub max_per_room: u32,
}

impl From<&SessionType> for SessionTypeCapView {
    fn from(st: &SessionType) -> Self {
        Self {
            extension_id: st.extension_id.clone(),
            r#type: st.r#type.clone(),
            max_participants: st.max_participants,
        }
    }
}

impl From<&SessionType> for SessionTypeAdminView {
    fn from(st: &SessionType) -> Self {
        Self {
            r#type: st.r#type.clone(),
            extension_id: st.extension_id.clone(),
            max_participants: st.max_participants,
            max_per_room: st.max_per_room,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SessionTypesConfig {
    pub types: HashMap<String, SessionType>,
    pub types_by_extension: HashMap<String, Vec<String>>,
}

impl SessionTypesConfig {
    pub fn get(&self, type_name: &str) -> Option<&SessionType> {
        self.types.get(type_name)
    }

    pub fn max_participants_for(&self, type_name: &str) -> Option<u32> {
        self.types.get(type_name).map(|st| st.max_participants)
    }

    pub fn max_per_room_for(&self, type_name: &str) -> Option<u32> {
        self.types.get(type_name).map(|st| st.max_per_room)
    }

    pub fn sorted_types(&self) -> Vec<SessionType> {
        let mut list: Vec<_> = self.types.values().cloned().collect();
        list.sort_by(|a, b| a.r#type.cmp(&b.r#type));
        list
    }
}

#[derive(Debug, Clone)]
pub struct SessionTypesState {
    pub declared_enabled: bool,
    pub allowlist_loaded: bool,
    pub config: SessionTypesConfig,
}

impl SessionTypesState {
    pub fn effective_enabled(&self) -> bool {
        self.declared_enabled && self.allowlist_loaded
    }
}

pub struct SessionTypesStore {
    state: RwLock<SessionTypesState>,
}

impl SessionTypesStore {
    pub fn new(state: SessionTypesState) -> Self {
        Self {
            state: RwLock::new(state),
        }
    }

    pub fn is_effective_enabled(&self) -> bool {
        match self.state.read() {
            Ok(guard) => guard.effective_enabled(),
            Err(poisoned) => poisoned.into_inner().effective_enabled(),
        }
    }

    pub fn get(&self, type_name: &str) -> Option<SessionType> {
        let guard = match self.state.read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if !guard.effective_enabled() {
            return None;
        }
        guard.config.get(type_name).cloned()
    }

    pub fn max_participants_for(&self, type_name: &str) -> Option<u32> {
        let guard = match self.state.read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if !guard.effective_enabled() {
            return None;
        }
        guard.config.max_participants_for(type_name)
    }

    pub fn max_per_room_for(&self, type_name: &str) -> Option<u32> {
        let guard = match self.state.read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if !guard.effective_enabled() {
            return None;
        }
        guard.config.max_per_room_for(type_name)
    }

    pub fn all(&self) -> Vec<SessionType> {
        let guard = match self.state.read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if !guard.effective_enabled() {
            return Vec::new();
        }
        guard.config.sorted_types()
    }

    pub fn capabilities_types(&self) -> Vec<SessionTypeCapView> {
        let guard = match self.state.read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if !guard.effective_enabled() {
            return Vec::new();
        }
        guard
            .config
            .sorted_types()
            .iter()
            .map(SessionTypeCapView::from)
            .collect()
    }

    pub fn admin_types(&self) -> Vec<SessionTypeAdminView> {
        let guard = match self.state.read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard
            .config
            .sorted_types()
            .iter()
            .map(SessionTypeAdminView::from)
            .collect()
    }

    pub fn swap(&self, new_state: SessionTypesState) {
        let mut guard = match self.state.write() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        *guard = new_state;
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SessionTypesError {
    #[error("session types config missing: {path}")]
    ConfigMissing { path: String },

    #[error("invalid session types config: {reason}")]
    InvalidConfig { line: Option<usize>, reason: String },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Deserialize)]
struct RawTomlConfig {
    session_type: Option<Vec<toml::Spanned<RawSessionType>>>,
}

#[derive(Deserialize)]
struct RawSessionType {
    r#type: Option<String>,
    extension_id: Option<String>,
    max_participants: Option<i64>,
    max_per_room: Option<i64>,
}

pub fn parse_and_validate_toml(
    contents: &str,
    server_max_participants: u32,
    server_max_per_room: u32,
) -> Result<SessionTypesConfig, SessionTypesError> {
    let raw: RawTomlConfig = match toml::from_str(contents) {
        Ok(r) => r,
        Err(e) => {
            let line = e.span().map(|span| {
                let end = span.start.min(contents.len());
                1 + contents[..end].chars().filter(|&c| c == '\n').count()
            });
            return Err(SessionTypesError::InvalidConfig {
                line,
                reason: e.message().to_string(),
            });
        }
    };

    let type_regex = get_type_regex();
    let mut config = SessionTypesConfig::default();

    let Some(session_types) = raw.session_type else {
        return Ok(config);
    };

    for spanned in session_types {
        let byte_offset = spanned.span().start.min(contents.len());
        let line = 1 + contents[..byte_offset]
            .chars()
            .filter(|&c| c == '\n')
            .count();
        let raw_st = spanned.into_inner();

        let type_str = match raw_st.r#type {
            Some(t) if !t.trim().is_empty() => t,
            _ => {
                return Err(SessionTypesError::InvalidConfig {
                    line: Some(line),
                    reason: "type must be non-empty".to_string(),
                });
            }
        };

        if !type_regex.is_match(&type_str) {
            return Err(SessionTypesError::InvalidConfig {
                line: Some(line),
                reason: format!("invalid type '{}': must match ^[a-z][a-z0-9_-]*$", type_str),
            });
        }

        let extension_id = match raw_st.extension_id {
            Some(ext) if !ext.trim().is_empty() => ext,
            _ => {
                return Err(SessionTypesError::InvalidConfig {
                    line: Some(line),
                    reason: format!("type '{}': extension_id must be non-empty", type_str),
                });
            }
        };

        let max_participants = match raw_st.max_participants {
            Some(val) if val >= 1 => val as u32,
            _ => {
                return Err(SessionTypesError::InvalidConfig {
                    line: Some(line),
                    reason: format!("type '{}': max_participants must be >= 1", type_str),
                });
            }
        };

        if max_participants > server_max_participants {
            return Err(SessionTypesError::InvalidConfig {
                line: Some(line),
                reason: format!(
                    "type '{}': max_participants ({}) exceeds server hard max ({})",
                    type_str, max_participants, server_max_participants
                ),
            });
        }

        let max_per_room = match raw_st.max_per_room {
            Some(val) if val >= 1 => val as u32,
            _ => {
                return Err(SessionTypesError::InvalidConfig {
                    line: Some(line),
                    reason: format!("type '{}': max_per_room must be >= 1", type_str),
                });
            }
        };

        if max_per_room > server_max_per_room {
            return Err(SessionTypesError::InvalidConfig {
                line: Some(line),
                reason: format!(
                    "type '{}': max_per_room ({}) exceeds server hard max ({})",
                    type_str, max_per_room, server_max_per_room
                ),
            });
        }

        if config.types.contains_key(&type_str) {
            return Err(SessionTypesError::InvalidConfig {
                line: Some(line),
                reason: format!("duplicate session type '{}'", type_str),
            });
        }

        let st = SessionType {
            r#type: type_str.clone(),
            extension_id: extension_id.clone(),
            max_participants,
            max_per_room,
        };

        config
            .types_by_extension
            .entry(extension_id)
            .or_default()
            .push(type_str.clone());
        config.types.insert(type_str, st);
    }

    Ok(config)
}

pub fn load_session_types_from_file(
    path: &Path,
    server_max_participants: u32,
    server_max_per_room: u32,
) -> Result<SessionTypesConfig, SessionTypesError> {
    if !path.exists() {
        return Err(SessionTypesError::ConfigMissing {
            path: path.display().to_string(),
        });
    }

    let contents = std::fs::read_to_string(path)?;
    parse_and_validate_toml(&contents, server_max_participants, server_max_per_room)
}

pub fn init_session_types_state(
    declared_enabled: bool,
    config_path: &str,
    server_max_participants: u32,
    server_max_per_room: u32,
) -> SessionTypesState {
    if !declared_enabled {
        return SessionTypesState {
            declared_enabled: false,
            allowlist_loaded: false,
            config: SessionTypesConfig::default(),
        };
    }

    let path = Path::new(config_path);
    match load_session_types_from_file(path, server_max_participants, server_max_per_room) {
        Ok(config) => SessionTypesState {
            declared_enabled: true,
            allowlist_loaded: true,
            config,
        },
        Err(err) => {
            tracing::error!(
                "Failed to load session types from '{}': {}",
                config_path,
                err
            );
            SessionTypesState {
                declared_enabled: true,
                allowlist_loaded: false,
                config: SessionTypesConfig::default(),
            }
        }
    }
}
