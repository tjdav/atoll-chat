use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

#[derive(Clone, Debug, Default)]
pub struct BotConnectionState {
    inner: Arc<RwLock<HashMap<String, Instant>>>,
}

impl BotConnectionState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn is_connected(&self, bot_id: &str) -> bool {
        let guard = self.inner.read().await;
        guard.contains_key(bot_id)
    }

    pub async fn mark_connected(&self, bot_id: impl Into<String>) {
        let mut guard = self.inner.write().await;
        guard.insert(bot_id.into(), Instant::now());
    }

    pub async fn mark_disconnected(&self, bot_id: &str) {
        let mut guard = self.inner.write().await;
        guard.remove(bot_id);
    }
}
