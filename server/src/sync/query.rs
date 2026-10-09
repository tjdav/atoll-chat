//! User-scoped state sync query engine and cursor management.
//!
//! # Client Cursor Flow (§6.22)
//!
//! On boot, after local SQLite hydration and before subscribing to WebSocket channels:
//! 1. Request `GET /users/me/sync?since_seq=<cursor>` (use 0 for initial full sync).
//! 2. Apply returned state rows in `user_seq` order.
//! 3. Store `max_seq` from the response as the new cursor.
//! 4. Subscribe to `private-user-{user_id}` on Sockudo.
//! 5. Apply live events as they arrive; ignore any event with `user_seq <= cursor`.
//! 6. Update the cursor on every applied row.
//! 7. If `{ "full_resync_required": true }` is received, discard local cursor and refetch all current state (`since_seq = 0`).

use crate::starred::StarredItemRow;
use crate::sync::{
    device_names::{self, DeviceStateRow},
    preferences, read_state, room_order, starred, PreferenceRow, ReadStateRow, RoomOrderSyncState,
    SyncError,
};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

pub struct SyncQuery {
    pub user_id: String,
    pub since_seq: i64,
    pub retention_days: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BotSettingSyncRow {
    pub bot_id: String,
    pub key: String,
    pub is_secret: bool,
    pub value_encrypted_client: Option<String>,
    pub user_seq: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncResponse {
    pub read_state: Vec<ReadStateRow>,
    pub user_preferences: Vec<PreferenceRow>,
    pub device_state: Vec<DeviceStateRow>,
    pub starred_items: Vec<StarredItemRow>,
    pub bot_settings: Vec<BotSettingSyncRow>,
    pub room_order: Option<RoomOrderSyncState>,
    pub max_seq: i64,
    pub full_resync_required: bool,
}

pub async fn execute_sync(pool: &SqlitePool, query: SyncQuery) -> Result<SyncResponse, SyncError> {
    let read_state = if query.since_seq == 0 {
        read_state::list_read_state_all(pool, &query.user_id).await?
    } else {
        read_state::list_read_state_since(pool, &query.user_id, query.since_seq).await?
    };

    let user_preferences = if query.since_seq == 0 {
        preferences::list_preferences_all(pool, &query.user_id).await?
    } else {
        preferences::list_preferences_since(pool, &query.user_id, query.since_seq).await?
    };

    let device_state = if query.since_seq == 0 {
        device_names::list_device_names_all(pool, &query.user_id)
            .await
            .map_err(|e| match e {
                device_names::DeviceNameSyncError::Database(err) => SyncError::Database(err),
                other => SyncError::Database(sqlx::Error::Protocol(other.to_string())),
            })?
    } else {
        device_names::list_device_names_since(pool, &query.user_id, query.since_seq)
            .await
            .map_err(|e| match e {
                device_names::DeviceNameSyncError::Database(err) => SyncError::Database(err),
                other => SyncError::Database(sqlx::Error::Protocol(other.to_string())),
            })?
    };

    let starred_items = if query.since_seq == 0 {
        starred::list_starred_items_all(pool, &query.user_id).await?
    } else {
        starred::list_starred_items_since(pool, &query.user_id, query.since_seq).await?
    };

    let current_room_order = room_order::get_room_order(pool, &query.user_id).await?;
    let room_order = match current_room_order {
        Some(ro) if query.since_seq == 0 || ro.user_seq > query.since_seq => Some(ro),
        _ => None,
    };

    let bot_settings_rows = sqlx::query(
        r#"
        SELECT bs.bot_id, bs.key, bs.is_secret, bs.value_encrypted_client, bs.user_seq
        FROM bot_settings bs
        JOIN bot_accounts ba ON ba.id = bs.bot_id
        WHERE ba.owner_user_id = ? AND (? = 0 OR bs.user_seq > ?)
        ORDER BY bs.user_seq ASC
        "#,
    )
    .bind(&query.user_id)
    .bind(query.since_seq)
    .bind(query.since_seq)
    .fetch_all(pool)
    .await?;

    let bot_settings: Vec<BotSettingSyncRow> = bot_settings_rows
        .into_iter()
        .map(|r| BotSettingSyncRow {
            bot_id: r.get("bot_id"),
            key: r.get("key"),
            is_secret: r.get::<i64, _>("is_secret") == 1,
            value_encrypted_client: r.get("value_encrypted_client"),
            user_seq: r.get("user_seq"),
        })
        .collect();

    let highest_allocated: Option<i64> =
        sqlx::query_scalar("SELECT next_seq - 1 FROM user_seq WHERE user_id = ?")
            .bind(&query.user_id)
            .fetch_optional(pool)
            .await?;

    let max_seq = std::cmp::max(query.since_seq, highest_allocated.unwrap_or(0));

    let retention_days = if query.retention_days == 0 {
        90
    } else {
        query.retention_days
    };

    let full_resync_required =
        is_full_resync_required(pool, &query.user_id, query.since_seq, retention_days).await?;

    Ok(SyncResponse {
        read_state,
        user_preferences,
        device_state,
        starred_items,
        bot_settings,
        room_order,
        max_seq,
        full_resync_required,
    })
}

async fn is_full_resync_required(
    pool: &SqlitePool,
    user_id: &str,
    since_seq: i64,
    retention_days: u64,
) -> Result<bool, SyncError> {
    if since_seq == 0 {
        return Ok(false);
    }

    let highest_allocated: Option<i64> =
        sqlx::query_scalar("SELECT next_seq - 1 FROM user_seq WHERE user_id = ?")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    let highest_seq = highest_allocated.unwrap_or(0);

    // 1. Check if since_seq is below the minimum retained user_seq
    // Outer WHERE min_s IS NOT NULL ensures that NULLs from empty tables are filtered out
    let min_seq: Option<i64> = sqlx::query_scalar(
        r#"
        SELECT MIN(min_s) FROM (
            SELECT MIN(user_seq) AS min_s FROM read_state WHERE user_id = ?
            UNION ALL
            SELECT MIN(user_seq) AS min_s FROM user_preferences WHERE user_id = ?
            UNION ALL
            SELECT MIN(user_seq) AS min_s FROM user_room_order WHERE user_id = ?
            UNION ALL
            SELECT MIN(user_seq) AS min_s FROM device_names WHERE user_id = ?
            UNION ALL
            SELECT MIN(user_seq) AS min_s FROM starred_items WHERE user_id = ?
            UNION ALL
            SELECT MIN(bs.user_seq) AS min_s FROM bot_settings bs JOIN bot_accounts ba ON ba.id = bs.bot_id WHERE ba.owner_user_id = ?
        ) WHERE min_s IS NOT NULL
        "#,
    )
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let min_retained_seq = match min_seq {
        Some(s) => s,
        None if highest_seq > 0 => highest_seq + 1,
        None => i64::MAX,
    };

    if since_seq < min_retained_seq {
        return Ok(true);
    }

    // 2. Check if state corresponding to user_seq <= since_seq is older than retention window
    let cutoff_sql = format!("-{} days", retention_days);
    let is_expired: Option<i32> = sqlx::query_scalar(
        r#"
        SELECT 1 FROM (
            SELECT updated_at AS ts FROM read_state WHERE user_id = ? AND user_seq <= ?
            UNION ALL
            SELECT updated_at AS ts FROM user_preferences WHERE user_id = ? AND user_seq <= ?
            UNION ALL
            SELECT updated_at AS ts FROM user_room_order WHERE user_id = ? AND user_seq <= ?
            UNION ALL
            SELECT updated_at AS ts FROM device_names WHERE user_id = ? AND user_seq <= ?
            UNION ALL
            SELECT starred_at AS ts FROM starred_items WHERE user_id = ? AND user_seq <= ?
            UNION ALL
            SELECT bs.updated_at AS ts FROM bot_settings bs JOIN bot_accounts ba ON ba.id = bs.bot_id WHERE ba.owner_user_id = ? AND bs.user_seq <= ?
        )
        WHERE ts < datetime('now', ?)
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .bind(since_seq)
    .bind(user_id)
    .bind(since_seq)
    .bind(user_id)
    .bind(since_seq)
    .bind(user_id)
    .bind(since_seq)
    .bind(user_id)
    .bind(since_seq)
    .bind(cutoff_sql)
    .fetch_optional(pool)
    .await?;

    if is_expired.is_some() {
        return Ok(true);
    }

    Ok(false)
}
