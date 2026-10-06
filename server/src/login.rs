use crate::opaque::DefaultCipherSuite;
use opaque_ke::ServerLogin;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const LOGIN_TTL: Duration = Duration::from_secs(300);

pub struct PendingLogin {
    pub user_id: String,
    pub username_token: String,
    pub encrypted_display: Option<String>,
    pub client_id: String,
    pub platform: String,
    pub server_login_state: ServerLogin<DefaultCipherSuite>,
    pub created_at: Instant,
}

#[derive(Clone)]
pub struct LoginStore {
    inner: Arc<Mutex<HashMap<String, PendingLogin>>>,
}

impl LoginStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn insert(&self, id: String, pending: PendingLogin) {
        let mut store = self.inner.lock().expect("lock poisoned");
        // Opportunistically purge expired entries on each insert
        store.retain(|_, p| p.created_at.elapsed() < LOGIN_TTL);
        store.insert(id, pending);
    }

    pub fn take(&self, id: &str) -> Option<PendingLogin> {
        let mut store = self.inner.lock().expect("lock poisoned");
        if let Some(pending) = store.remove(id) {
            if pending.created_at.elapsed() < LOGIN_TTL {
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

impl Default for LoginStore {
    fn default() -> Self {
        Self::new()
    }
}
