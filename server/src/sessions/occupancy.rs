use crate::config::Config;
use crate::devices;
use crate::sockudo::Publisher;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RosterUserItem {
    pub user_id: String,
    pub client_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RosterResponse {
    pub roster: Vec<RosterUserItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaConfig {
    pub ice_servers: Vec<IceServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinResponse {
    pub roster: Vec<RosterUserItem>,
    pub media_config: MediaConfig,
}

#[derive(thiserror::Error, Debug)]
pub enum OccupancyError {
    #[error("Sessions disabled")]
    SessionsDisabled,
    #[error("Session not found")]
    SessionNotFound,
    #[error("Room not found")]
    RoomNotFound,
    #[error("Forbidden")]
    Forbidden,
    #[error("Invalid client_id")]
    InvalidClientId,
    #[error("Session full")]
    SessionFull,
    #[error("Not a participant")]
    NotAParticipant,
    #[error("Device error: {0}")]
    Device(#[from] crate::devices::DeviceError),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

#[derive(Debug)]
pub struct Participant {
    pub client_ids: HashSet<String>,
    pub last_heartbeat: HashMap<String, Instant>,
}

#[derive(Debug)]
pub struct SessionOccupancy {
    pub room_id: String,
    pub participants: HashMap<String, Participant>,
    pub session_started_at: Instant,
    pub last_published_count: u32,
    pub last_published_at: Option<Instant>,
    pub debounce_handle: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Clone, Default)]
pub struct OccupancyStore(pub Arc<RwLock<HashMap<String, SessionOccupancy>>>);

impl OccupancyStore {
    pub fn new() -> Self {
        Self(Arc::new(RwLock::new(HashMap::new())))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn join(
        &self,
        pool: &SqlitePool,
        publisher: &Arc<Publisher>,
        config: &Config,
        room_id: &str,
        session_id: &str,
        user_id: &str,
        client_id: &str,
        max_participants_cap: u32,
    ) -> Result<JoinResponse, OccupancyError> {
        let dev = devices::find_by_client_id(pool, user_id, client_id).await?;
        if dev.is_none() {
            return Err(OccupancyError::InvalidClientId);
        }

        let mut lock = self.0.write().await;
        let entry = lock
            .entry(session_id.to_string())
            .or_insert_with(|| SessionOccupancy {
                room_id: room_id.to_string(),
                participants: HashMap::new(),
                session_started_at: Instant::now(),
                last_published_count: 0,
                last_published_at: None,
                debounce_handle: None,
            });

        if !entry.participants.contains_key(user_id)
            && entry.participants.len() >= max_participants_cap as usize
        {
            return Err(OccupancyError::SessionFull);
        }

        let participant = entry
            .participants
            .entry(user_id.to_string())
            .or_insert_with(|| Participant {
                client_ids: HashSet::new(),
                last_heartbeat: HashMap::new(),
            });

        participant.client_ids.insert(client_id.to_string());
        participant
            .last_heartbeat
            .insert(client_id.to_string(), Instant::now());

        let mut roster: Vec<RosterUserItem> = entry
            .participants
            .iter()
            .map(|(uid, part)| {
                let mut cids: Vec<String> = part.client_ids.iter().cloned().collect();
                cids.sort();
                RosterUserItem {
                    user_id: uid.clone(),
                    client_ids: cids,
                }
            })
            .collect();
        roster.sort_by(|a, b| a.user_id.cmp(&b.user_id));

        ensure_debounce(
            entry,
            session_id,
            self.clone(),
            publisher.clone(),
            config.session_occupancy_debounce_ms,
        );

        drop(lock);

        let ice_servers = if config.sessions_enabled && !config.turn_url.trim().is_empty() {
            match crate::calls::turn::generate_turn_credentials(config) {
                Ok(turn_resp) => vec![IceServer {
                    urls: turn_resp.urls,
                    username: turn_resp.username,
                    credential: turn_resp.credential,
                }],
                Err(_) => vec![],
            }
        } else {
            vec![]
        };

        Ok(JoinResponse {
            roster,
            media_config: MediaConfig { ice_servers },
        })
    }

    pub async fn leave(
        &self,
        pool: &SqlitePool,
        publisher: &Arc<Publisher>,
        config: &Config,
        session_id: &str,
        user_id: &str,
        client_id: &str,
    ) -> Result<(), OccupancyError> {
        let dev = devices::find_by_client_id(pool, user_id, client_id).await?;
        if dev.is_none() {
            return Err(OccupancyError::InvalidClientId);
        }

        let mut lock = self.0.write().await;
        if let Some(entry) = lock.get_mut(session_id) {
            let mut count_changed = false;
            if let Some(part) = entry.participants.get_mut(user_id) {
                part.client_ids.remove(client_id);
                part.last_heartbeat.remove(client_id);
                if part.client_ids.is_empty() {
                    entry.participants.remove(user_id);
                    count_changed = true;
                }
            }

            if count_changed {
                ensure_debounce(
                    entry,
                    session_id,
                    self.clone(),
                    publisher.clone(),
                    config.session_occupancy_debounce_ms,
                );
            }
        }

        Ok(())
    }

    pub async fn heartbeat(
        &self,
        pool: &SqlitePool,
        session_id: &str,
        user_id: &str,
        client_id: &str,
    ) -> Result<(), OccupancyError> {
        let dev = devices::find_by_client_id(pool, user_id, client_id).await?;
        if dev.is_none() {
            return Err(OccupancyError::InvalidClientId);
        }

        let mut lock = self.0.write().await;
        let entry = lock
            .get_mut(session_id)
            .ok_or(OccupancyError::NotAParticipant)?;
        let part = entry
            .participants
            .get_mut(user_id)
            .ok_or(OccupancyError::NotAParticipant)?;

        if !part.client_ids.contains(client_id) {
            return Err(OccupancyError::NotAParticipant);
        }

        part.last_heartbeat
            .insert(client_id.to_string(), Instant::now());
        Ok(())
    }

    pub async fn get_roster(
        &self,
        session_id: &str,
        user_id: &str,
    ) -> Result<RosterResponse, OccupancyError> {
        let lock = self.0.read().await;
        let entry = lock
            .get(session_id)
            .ok_or(OccupancyError::NotAParticipant)?;
        if !entry.participants.contains_key(user_id) {
            return Err(OccupancyError::NotAParticipant);
        }

        let mut roster: Vec<RosterUserItem> = entry
            .participants
            .iter()
            .map(|(uid, part)| {
                let mut cids: Vec<String> = part.client_ids.iter().cloned().collect();
                cids.sort();
                RosterUserItem {
                    user_id: uid.clone(),
                    client_ids: cids,
                }
            })
            .collect();
        roster.sort_by(|a, b| a.user_id.cmp(&b.user_id));

        Ok(RosterResponse { roster })
    }

    pub async fn get_participant_count(&self, session_id: &str) -> u32 {
        let lock = self.0.read().await;
        if let Some(entry) = lock.get(session_id) {
            entry.participants.len() as u32
        } else {
            0
        }
    }

    pub async fn teardown_session(&self, publisher: &Publisher, room_id: &str, session_id: &str) {
        let mut lock = self.0.write().await;
        if let Some(mut entry) = lock.remove(session_id) {
            if let Some(handle) = entry.debounce_handle.take() {
                handle.abort();
            }
            drop(lock);
            publish_occupancy_event(publisher, room_id, session_id, 0).await;
        }
    }

    pub async fn cleanup_stale_participants(&self, publisher: &Arc<Publisher>, config: &Config) {
        let mut lock = self.0.write().await;
        let now = Instant::now();
        let timeout = Duration::from_secs(config.session_heartbeat_timeout_seconds);

        for (session_id, entry) in lock.iter_mut() {
            let mut count_changed = false;
            let user_ids: Vec<String> = entry.participants.keys().cloned().collect();

            for uid in user_ids {
                if let Some(part) = entry.participants.get_mut(&uid) {
                    part.last_heartbeat
                        .retain(|_cid, last_hb| now.duration_since(*last_hb) <= timeout);
                    part.client_ids
                        .retain(|cid| part.last_heartbeat.contains_key(cid));

                    if part.client_ids.is_empty() {
                        entry.participants.remove(&uid);
                        count_changed = true;
                    }
                }
            }

            if count_changed {
                ensure_debounce(
                    entry,
                    session_id,
                    self.clone(),
                    publisher.clone(),
                    config.session_occupancy_debounce_ms,
                );
            }
        }
    }

    pub async fn is_participant(&self, session_id: &str, user_id: &str) -> bool {
        let lock = self.0.read().await;
        if let Some(entry) = lock.get(session_id) {
            return entry.participants.contains_key(user_id);
        }
        false
    }

    pub async fn is_participant_of_client(
        &self,
        session_id: &str,
        user_id: &str,
        client_id: &str,
    ) -> bool {
        let lock = self.0.read().await;
        if let Some(entry) = lock.get(session_id) {
            if let Some(part) = entry.participants.get(user_id) {
                return part.client_ids.contains(client_id);
            }
        }
        false
    }

    pub async fn is_client_of(&self, session_id: &str, user_id: &str, client_id: &str) -> bool {
        self.is_participant_of_client(session_id, user_id, client_id)
            .await
    }

    pub async fn find_user_for_client(&self, session_id: &str, client_id: &str) -> Option<String> {
        let lock = self.0.read().await;
        if let Some(entry) = lock.get(session_id) {
            for (user_id, part) in &entry.participants {
                if part.client_ids.contains(client_id) {
                    return Some(user_id.clone());
                }
            }
        }
        None
    }

    pub async fn participant_users(&self, session_id: &str) -> Vec<String> {
        let lock = self.0.read().await;
        if let Some(entry) = lock.get(session_id) {
            let mut users: Vec<String> = entry.participants.keys().cloned().collect();
            users.sort();
            return users;
        }
        Vec::new()
    }

    pub async fn participant_user_ids(&self, session_id: &str) -> Vec<String> {
        self.participant_users(session_id).await
    }
}

fn ensure_debounce(
    entry: &mut SessionOccupancy,
    session_id: &str,
    store: OccupancyStore,
    publisher: Arc<Publisher>,
    debounce_ms: u64,
) {
    if entry.debounce_handle.is_none() {
        let session_id_clone = session_id.to_string();
        let store_clone = store;
        let publisher_clone = publisher;
        let handle = tokio::spawn(async move {
            if debounce_ms > 0 {
                tokio::time::sleep(Duration::from_millis(debounce_ms)).await;
            }
            let mut lock = store_clone.0.write().await;
            if let Some(entry) = lock.get_mut(&session_id_clone) {
                entry.debounce_handle = None;
                let current_count = entry.participants.len() as u32;
                let room_id = entry.room_id.clone();
                let should_publish = current_count != entry.last_published_count;
                if should_publish {
                    entry.last_published_count = current_count;
                    entry.last_published_at = Some(Instant::now());
                }
                if current_count == 0 {
                    lock.remove(&session_id_clone);
                }
                drop(lock);

                if should_publish {
                    publish_occupancy_event(
                        &publisher_clone,
                        &room_id,
                        &session_id_clone,
                        current_count,
                    )
                    .await;
                }
            }
        });
        entry.debounce_handle = Some(handle);
    }
}

async fn publish_occupancy_event(
    publisher: &Publisher,
    room_id: &str,
    session_id: &str,
    participant_count: u32,
) {
    let channel = format!("private-room-{room_id}");
    let payload = serde_json::json!({
        "room_id": room_id,
        "session_id": session_id,
        "participant_count": participant_count,
    });
    let _ = publisher
        .publish(&channel, "session.occupancy", payload)
        .await;
}
