pub mod list;
pub mod write;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StarredItemRow {
    pub user_id: String,
    pub item_id: String,
    pub item_type: String,
    pub room_id: String,
    pub user_seq: i64,
    pub starred_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StarredItemView {
    pub item_id: String,
    pub item_type: String,
    pub room_id: String,
    pub starred_at: DateTime<Utc>,
    pub user_seq: i64,
    pub deleted_at: Option<DateTime<Utc>>,
}

impl From<StarredItemRow> for StarredItemView {
    fn from(row: StarredItemRow) -> Self {
        Self {
            item_id: row.item_id,
            item_type: row.item_type,
            room_id: row.room_id,
            starred_at: row.starred_at,
            user_seq: row.user_seq,
            deleted_at: row.deleted_at,
        }
    }
}
