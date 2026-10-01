use crate::sync::{read_state, ReadStateRow, SyncError};
use serde::Serialize;
use sqlx::SqlitePool;

pub struct SyncQuery {
    pub user_id: String,
    pub since_seq: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreferenceRow {}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceStateRow {}

#[derive(Debug, Clone, Serialize)]
pub struct StarredItemRow {}

#[derive(Debug, Clone, Serialize)]
pub struct SyncResponse {
    pub read_state: Vec<ReadStateRow>,
    pub user_preferences: Vec<PreferenceRow>,
    pub device_state: Vec<DeviceStateRow>,
    pub starred_items: Vec<StarredItemRow>,
    pub max_seq: i64,
    pub full_resync_required: bool,
}

pub async fn execute_sync(pool: &SqlitePool, query: SyncQuery) -> Result<SyncResponse, SyncError> {
    let read_state = if query.since_seq == 0 {
        read_state::list_read_state_all(pool, &query.user_id).await?
    } else {
        read_state::list_read_state_since(pool, &query.user_id, query.since_seq).await?
    };

    let max_read_state_seq = read_state
        .iter()
        .map(|r| r.user_seq)
        .max()
        .unwrap_or(query.since_seq);
    let max_seq = std::cmp::max(query.since_seq, max_read_state_seq);

    Ok(SyncResponse {
        read_state,
        user_preferences: Vec::new(),
        device_state: Vec::new(),
        starred_items: Vec::new(),
        max_seq,
        full_resync_required: false,
    })
}
