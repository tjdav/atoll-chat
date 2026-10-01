use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const REGISTRATION_TTL: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
pub struct PendingRegistration {
    pub username_token: String,
    pub credential_id: [u8; 64],
    pub created_at: Instant,
}

#[derive(Debug, Clone)]
pub struct RegistrationStore {
    inner: Arc<Mutex<HashMap<String, PendingRegistration>>>,
}

impl RegistrationStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn insert(&self, id: String, pending: PendingRegistration) {
        let mut store = self.inner.lock().expect("lock poisoned");
        // Opportunistically purge expired entries on each insert
        store.retain(|_, p| p.created_at.elapsed() < REGISTRATION_TTL);
        store.insert(id, pending);
    }

    pub fn take(&self, id: &str) -> Option<PendingRegistration> {
        let mut store = self.inner.lock().expect("lock poisoned");
        if let Some(pending) = store.remove(id) {
            if pending.created_at.elapsed() < REGISTRATION_TTL {
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

impl Default for RegistrationStore {
    fn default() -> Self {
        Self::new()
    }
}
