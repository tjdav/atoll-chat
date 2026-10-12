pub mod list;
pub mod write;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, ToSchema)]
pub struct StarredItemRow {
    pub user_id: String,
    pub item_id: String,
    pub item_type: String,
    pub room_id: String,
    pub user_seq: i64,
    #[schema(value_type = String, example = "2026-10-12T00:00:00Z")]
    pub starred_at: DateTime<Utc>,
    #[schema(value_type = Option<String>, example = "2026-10-12T00:00:00Z")]
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StarredItemView {
    pub item_id: String,
    pub item_type: String,
    pub room_id: String,
    #[schema(value_type = String, example = "2026-10-12T00:00:00Z")]
    pub starred_at: DateTime<Utc>,
    pub user_seq: i64,
    #[schema(value_type = Option<String>, example = "2026-10-12T00:00:00Z")]
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
