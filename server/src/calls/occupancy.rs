use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Default)]
pub struct CallOccupancyStore {
    inner: Arc<RwLock<HashMap<String, CallOccupancy>>>,
}

#[derive(Debug, Clone)]
pub struct CallOccupancy {
    pub participants: HashMap<String, ParticipantEntry>, // user_id -> ParticipantEntry
    pub call_started_at: Instant,
}

#[derive(Debug, Clone, Default)]
pub struct ParticipantEntry {
    pub client_ids: HashSet<String>,
}

impl CallOccupancyStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn add_client(&self, call_id: &str, user_id: &str, client_id: &str) {
        let mut map = self.inner.write().await;
        let call = map
            .entry(call_id.to_string())
            .or_insert_with(|| CallOccupancy {
                participants: HashMap::new(),
                call_started_at: Instant::now(),
            });
        let participant = call
            .participants
            .entry(user_id.to_string())
            .or_insert_with(ParticipantEntry::default);
        participant.client_ids.insert(client_id.to_string());
    }

    pub async fn remove_client(&self, call_id: &str, user_id: &str, client_id: &str) {
        let mut map = self.inner.write().await;
        let mut remove_call = false;
        if let Some(call) = map.get_mut(call_id) {
            let mut remove_user_entry = false;
            if let Some(participant) = call.participants.get_mut(user_id) {
                participant.client_ids.remove(client_id);
                if participant.client_ids.is_empty() {
                    remove_user_entry = true;
                }
            }
            if remove_user_entry {
                call.participants.remove(user_id);
            }
            if call.participants.is_empty() {
                remove_call = true;
            }
        }
        if remove_call {
            map.remove(call_id);
        }
    }

    pub async fn remove_user(&self, call_id: &str, user_id: &str) {
        let mut map = self.inner.write().await;
        let mut remove_call = false;
        if let Some(call) = map.get_mut(call_id) {
            call.participants.remove(user_id);
            if call.participants.is_empty() {
                remove_call = true;
            }
        }
        if remove_call {
            map.remove(call_id);
        }
    }

    pub async fn is_participant(&self, call_id: &str, user_id: &str) -> bool {
        let map = self.inner.read().await;
        if let Some(call) = map.get(call_id) {
            if let Some(participant) = call.participants.get(user_id) {
                return !participant.client_ids.is_empty();
            }
        }
        false
    }

    pub async fn is_client_owner(&self, call_id: &str, user_id: &str, client_id: &str) -> bool {
        let map = self.inner.read().await;
        if let Some(call) = map.get(call_id) {
            if let Some(participant) = call.participants.get(user_id) {
                return participant.client_ids.contains(client_id);
            }
        }
        false
    }

    pub async fn find_user_for_client(&self, call_id: &str, client_id: &str) -> Option<String> {
        let map = self.inner.read().await;
        if let Some(call) = map.get(call_id) {
            for (user_id, participant) in &call.participants {
                if participant.client_ids.contains(client_id) {
                    return Some(user_id.clone());
                }
            }
        }
        None
    }

    pub async fn participant_user_ids(&self, call_id: &str, excluding: &str) -> Vec<String> {
        let map = self.inner.read().await;
        let mut result = Vec::new();
        if let Some(call) = map.get(call_id) {
            for (user_id, participant) in &call.participants {
                if user_id != excluding && !participant.client_ids.is_empty() {
                    result.push(user_id.clone());
                }
            }
        }
        result
    }

    pub async fn clear_call(&self, call_id: &str) {
        let mut map = self.inner.write().await;
        map.remove(call_id);
    }
}
