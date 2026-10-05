use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub struct SyncPruningJob;

const ALLOWED_SYNC_TABLES: [&str; 6] = [
    "read_state",
    "user_preferences",
    "user_room_order",
    "device_names",
    "starred_items",
    "bot_settings",
];

#[async_trait]
impl CleanupJob for SyncPruningJob {
    fn name(&self) -> &'static str {
        "sync_pruning"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let retention_days = if ctx.config.sync_event_retention_days == 0 {
            90
        } else {
            ctx.config.sync_event_retention_days
        };
        let cutoff_sql = format!("-{} days", retention_days);

        let mut total_deleted = 0u64;
        let mut table_notes = Vec::new();

        for table in ALLOWED_SYNC_TABLES {
            if has_deleted_at_column(ctx.pool, table).await? {
                let candidate_sql = format!(
                    "SELECT {table}.rowid, {table}.user_id, {table}.user_seq, (SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id) AS max_user_seq FROM {table} WHERE {table}.deleted_at IS NOT NULL AND {table}.deleted_at < datetime('now', ?)"
                );
                let candidates: Vec<(i64, String, i64, Option<i64>)> =
                    sqlx::query_as(&candidate_sql)
                        .bind(&cutoff_sql)
                        .fetch_all(ctx.pool)
                        .await?;

                let mut skipped_count = 0u64;
                let mut valid_rowids = Vec::new();

                for (rowid, user_id, user_seq, max_user_seq) in candidates {
                    let is_valid = match max_user_seq {
                        Some(max_seq) => user_seq <= max_seq,
                        None => false,
                    };
                    if is_valid {
                        valid_rowids.push(rowid);
                    } else {
                        skipped_count += 1;
                        tracing::warn!(
                            table = table,
                            user_id = %user_id,
                            "skipped tombstone violating user_seq invariant"
                        );
                    }
                }

                let mut rows_deleted = 0u64;
                for chunk in valid_rowids.chunks(500) {
                    let mut query_str = format!("DELETE FROM {table} WHERE rowid IN (");
                    for i in 0..chunk.len() {
                        if i > 0 {
                            query_str.push_str(", ");
                        }
                        query_str.push('?');
                    }
                    query_str.push(')');

                    let mut query = sqlx::query(&query_str);
                    for id in chunk {
                        query = query.bind(id);
                    }

                    let res = query.execute(ctx.pool).await?;
                    rows_deleted += res.rows_affected();
                }

                total_deleted += rows_deleted;

                tracing::info!(
                    table = table,
                    deleted = rows_deleted,
                    skipped = skipped_count,
                    "pruned tombstones for sync table"
                );
                table_notes.push(format!("{}={}", table, rows_deleted));
            } else {
                tracing::debug!(
                    table = table,
                    "skipping sync table pruning (table absent or missing deleted_at column)"
                );
                table_notes.push(format!("{}=0", table));
            }
        }

        Ok(CleanupReport {
            rows_deleted: total_deleted,
            notes: vec![format!(
                "pruned tombstones older than {} days ({})",
                retention_days,
                table_notes.join(", ")
            )],
        })
    }
}

async fn has_deleted_at_column(
    pool: &sqlx::SqlitePool,
    table_name: &'static str,
) -> Result<bool, sqlx::Error> {
    if !ALLOWED_SYNC_TABLES.contains(&table_name) {
        return Ok(false);
    }

    let exists: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
            .bind(table_name)
            .fetch_optional(pool)
            .await?;

    if exists.is_none() {
        return Ok(false);
    }

    let pragma_sql = format!(
        "SELECT 1 FROM pragma_table_info('{}') WHERE name='deleted_at'",
        table_name
    );
    let has_col: Option<i32> = sqlx::query_scalar(&pragma_sql).fetch_optional(pool).await?;

    Ok(has_col.is_some())
}
