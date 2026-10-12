use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::RwLock;
use tokio::time::{Duration, Instant};

pub const ROOM_EVENT_BROADCAST_CAPACITY: usize = 1024;

#[derive(Clone, Debug)]
pub struct RoomEventEnvelope {
    pub room_id: String,
    pub event: String,
    pub data: serde_json::Value,
}

#[derive(Clone)]
pub struct RoomEventBroadcast {
    sender: broadcast::Sender<RoomEventEnvelope>,
}

impl RoomEventBroadcast {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn publish(&self, envelope: RoomEventEnvelope) {
        let _ = self.sender.send(envelope);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RoomEventEnvelope> {
        self.sender.subscribe()
    }
}

impl Default for RoomEventBroadcast {
    fn default() -> Self {
        Self::new(ROOM_EVENT_BROADCAST_CAPACITY)
    }
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct ObserverKey {
    pub bot_id: String,
    pub room_id: String,
}

#[derive(Debug, Clone)]
pub struct ObserverCursor {
    pub last_event_id: u64,
    pub expires_at: Instant,
}

#[derive(Clone)]
pub struct ObserverCursorStore {
    inner: Arc<RwLock<HashMap<ObserverKey, ObserverCursor>>>,
}

impl ObserverCursorStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get(&self, key: &ObserverKey) -> Option<ObserverCursor> {
        let guard = self.inner.read().await;
        if let Some(cursor) = guard.get(key) {
            if cursor.expires_at > Instant::now() {
                return Some(cursor.clone());
            }
        }
        None
    }

    pub async fn update(&self, key: ObserverKey, last_event_id: u64, ttl: Duration) {
        let mut guard = self.inner.write().await;
        let expires_at = Instant::now() + ttl;
        guard.insert(
            key,
            ObserverCursor {
                last_event_id,
                expires_at,
            },
        );
    }

    pub async fn refresh_expiry(&self, key: &ObserverKey, ttl: Duration) {
        let mut guard = self.inner.write().await;
        if let Some(cursor) = guard.get_mut(key) {
            cursor.expires_at = Instant::now() + ttl;
        }
    }

    pub async fn prune_expired(&self) {
        let mut guard = self.inner.write().await;
        let now = Instant::now();
        guard.retain(|_, cursor| cursor.expires_at > now);
    }

    pub fn spawn_pruner(&self, interval: Duration) -> tokio::task::JoinHandle<()> {
        let store = self.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                store.prune_expired().await;
            }
        })
    }
}

impl Default for ObserverCursorStore {
    fn default() -> Self {
        Self::new()
    }
}
