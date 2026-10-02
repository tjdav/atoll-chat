use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const RECOVERY_TTL: Duration = Duration::from_secs(600);

#[derive(Debug, Clone)]
pub struct PendingRecovery {
    pub user_id: String,
    pub recovery_code_id: String,
    pub credential_id: [u8; 64],
    pub created_at: Instant,
}

#[derive(Debug, Clone)]
pub struct RecoveryStore {
    inner: Arc<Mutex<HashMap<String, PendingRecovery>>>,
}

impl RecoveryStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn insert(&self, token: String, pending: PendingRecovery) {
        let mut store = self.inner.lock().expect("lock poisoned");
        // Opportunistically purge expired entries on each insert
        store.retain(|_, p| p.created_at.elapsed() < RECOVERY_TTL);
        store.insert(token, pending);
    }

    pub fn take(&self, token: &str) -> Option<PendingRecovery> {
        let mut store = self.inner.lock().expect("lock poisoned");
        if let Some(pending) = store.remove(token) {
            if pending.created_at.elapsed() < RECOVERY_TTL {
                Some(pending)
            } else {
                None
            }
        } else {
            None
        }
    }

    pub fn purge_expired(&self, max_age: Duration) -> usize {
        let mut store = self.inner.lock().expect("lock poisoned");
        let initial_len = store.len();
        store.retain(|_, p| p.created_at.elapsed() < max_age);
        initial_len - store.len()
    }
}

impl Default for RecoveryStore {
    fn default() -> Self {
        Self::new()
    }
}
