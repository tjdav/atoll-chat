use regex::Regex;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, OnceLock, RwLock};
use tracing::warn;

static DOMAIN_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_domain_regex() -> &'static Regex {
    DOMAIN_REGEX.get_or_init(|| {
        Regex::new(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$")
            .expect("valid static domain regex")
    })
}

pub fn parse_and_validate_domain(raw: &str) -> Option<String> {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    let regex = get_domain_regex();
    if regex.is_match(&trimmed) {
        Some(trimmed)
    } else {
        warn!(
            target: "extension_proxy",
            "Skipping malformed domain blocklist entry '{}': invalid domain syntax",
            raw
        );
        None
    }
}

#[derive(Debug, Clone, Default)]
pub struct DomainBlocklist {
    pub suffixes: Vec<String>,
}

impl DomainBlocklist {
    pub fn is_blocked(&self, host: &str) -> bool {
        if self.suffixes.is_empty() {
            return false;
        }
        let h = host.to_lowercase();
        for suffix in &self.suffixes {
            if h == *suffix || h.ends_with(&format!(".{}", suffix)) {
                return true;
            }
        }
        false
    }

    pub fn len(&self) -> usize {
        self.suffixes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.suffixes.is_empty()
    }
}

pub struct DomainBlocklistStore {
    inner: RwLock<Arc<DomainBlocklist>>,
}

impl DomainBlocklistStore {
    pub fn new(blocklist: DomainBlocklist) -> Self {
        Self {
            inner: RwLock::new(Arc::new(blocklist)),
        }
    }

    pub fn get(&self) -> Arc<DomainBlocklist> {
        let guard = match self.inner.read() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        Arc::clone(&*guard)
    }

    pub fn swap(&self, new_blocklist: DomainBlocklist) {
        let mut guard = match self.inner.write() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        *guard = Arc::new(new_blocklist);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BlocklistError {
    #[error("blocklist file not found: {path}")]
    FileNotFound { path: String },

    #[error("failed to read blocklist file '{path}': {source}")]
    IoError {
        path: String,
        source: std::io::Error,
    },
}

pub fn load_blocklist(
    env_domains: &str,
    file_path: &str,
) -> Result<DomainBlocklist, BlocklistError> {
    let mut unique_suffixes = HashSet::new();

    // 1. Process environment variable string (comma-separated)
    if !env_domains.trim().is_empty() {
        for part in env_domains.split(',') {
            if let Some(domain) = parse_and_validate_domain(part) {
                unique_suffixes.insert(domain);
            }
        }
    }

    // 2. Process file if specified
    let path_str = file_path.trim();
    if !path_str.is_empty() {
        let path = Path::new(path_str);
        if !path.exists() {
            return Err(BlocklistError::FileNotFound {
                path: path_str.to_string(),
            });
        }

        let content = std::fs::read_to_string(path).map_err(|err| BlocklistError::IoError {
            path: path_str.to_string(),
            source: err,
        })?;

        for line in content.lines() {
            let line_trimmed = line.trim();
            if line_trimmed.is_empty() || line_trimmed.starts_with('#') {
                continue;
            }
            if let Some(domain) = parse_and_validate_domain(line_trimmed) {
                unique_suffixes.insert(domain);
            }
        }
    }

    let mut suffixes: Vec<String> = unique_suffixes.into_iter().collect();
    suffixes.sort();

    Ok(DomainBlocklist { suffixes })
}

pub fn init_blocklist_store(env_domains: &str, file_path: &str) -> DomainBlocklistStore {
    match load_blocklist(env_domains, file_path) {
        Ok(blocklist) => DomainBlocklistStore::new(blocklist),
        Err(err) => {
            warn!(
                target: "extension_proxy",
                "Failed to load blocklist file at startup: {}. Initializing with empty or env-only blocklist.",
                err
            );
            // Fallback to env-only if file fails at startup
            let env_only = load_blocklist(env_domains, "").unwrap_or_default();
            DomainBlocklistStore::new(env_only)
        }
    }
}
