use crate::sync::SyncError;
use serde::Serialize;
use sqlx::SqlitePool;

pub struct SyncQuery {
    pub user_id: String,
    pub since_seq: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadStateRow {}

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

pub async fn execute_sync(_pool: &SqlitePool, query: SyncQuery) -> Result<SyncResponse, SyncError> {
    Ok(SyncResponse {
        read_state: Vec::new(),
        user_preferences: Vec::new(),
        device_state: Vec::new(),
        starred_items: Vec::new(),
        max_seq: query.since_seq,
        full_resync_required: false,
    })
}
