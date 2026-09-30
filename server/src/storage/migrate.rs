use chrono::{DateTime, Utc};
use futures::stream::{self, StreamExt};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::sync::Arc;
use tracing::{info, warn};

use super::{build_storage_for, Storage, StorageError};
use crate::config::Config;

pub struct MigrationOptions {
    pub from: String,
    pub to: String,
    pub batch_size: usize,
    pub concurrency: usize,
    pub delete_source: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Default)]
pub struct MigrationProgress {
    pub total: u64,
    pub processed: u64,
    pub migrated: u64,
    pub skipped: u64,
    pub failed: u64,
    pub bytes_transferred: u64,
}

#[derive(Debug, Clone)]
pub struct MigrationFailure {
    pub attachment_id: String,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct MigrationReport {
    pub progress: MigrationProgress,
    pub failures: Vec<MigrationFailure>,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct RowToMigrate {
    id: String,
    storage_key: String,
    padded_size: i64,
}

enum MigrationOutcome {
    Migrated { bytes: u64 },
    Failed(MigrationFailure),
}

pub async fn migrate_storage(
    pool: &SqlitePool,
    config: &Config,
    options: MigrationOptions,
) -> Result<MigrationReport, StorageError> {
    if options.from != "fs" && options.from != "s3" {
        return Err(StorageError::Config(format!(
            "Unsupported source backend: {}",
            options.from
        )));
    }
    if options.to != "fs" && options.to != "s3" {
        return Err(StorageError::Config(format!(
            "Unsupported destination backend: {}",
            options.to
        )));
    }

    let source = build_storage_for(config, &options.from)?;
    let destination = build_storage_for(config, &options.to)?;

    migrate_storage_with_backends(pool, source, destination, options).await
}

pub async fn migrate_storage_with_backends(
    pool: &SqlitePool,
    source: Arc<dyn Storage>,
    destination: Arc<dyn Storage>,
    options: MigrationOptions,
) -> Result<MigrationReport, StorageError> {
    let started_at = Utc::now();

    let total_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE storage_backend = ?")
            .bind(&options.from)
            .fetch_one(pool)
            .await
            .map_err(|e| StorageError::Config(format!("Database query error: {}", e)))?;

    let total = total_count as u64;

    let batch_size = if (1..=1000).contains(&options.batch_size) {
        options.batch_size
    } else {
        100
    };

    let concurrency = if (1..=32).contains(&options.concurrency) {
        options.concurrency
    } else {
        4
    };

    if options.from == options.to {
        let progress = MigrationProgress {
            total,
            processed: 0,
            migrated: 0,
            skipped: total,
            failed: 0,
            bytes_transferred: 0,
        };
        let finished_at = Utc::now();
        info!(
            "storage migrate complete total={} migrated=0 skipped={} failed=0 bytes=0 duration_s={:.1}",
            total,
            total,
            (finished_at - started_at).num_milliseconds() as f64 / 1000.0
        );
        return Ok(MigrationReport {
            progress,
            failures: Vec::new(),
            started_at,
            finished_at,
        });
    }

    let mut progress = MigrationProgress {
        total,
        processed: 0,
        migrated: 0,
        skipped: 0,
        failed: 0,
        bytes_transferred: 0,
    };
    let mut failures = Vec::new();
    let mut batch_num = 0usize;
    let mut last_id: Option<String> = None;

    loop {
        let batch_rows: Vec<RowToMigrate> = match &last_id {
            None => sqlx::query_as(
                r#"
                    SELECT id, storage_key, padded_size
                    FROM attachments
                    WHERE storage_backend = ?
                    ORDER BY id ASC
                    LIMIT ?
                    "#,
            )
            .bind(&options.from)
            .bind(batch_size as i64)
            .fetch_all(pool)
            .await
            .map_err(|e| StorageError::Config(format!("Database query error: {}", e)))?,
            Some(prev_id) => sqlx::query_as(
                r#"
                    SELECT id, storage_key, padded_size
                    FROM attachments
                    WHERE storage_backend = ? AND id > ?
                    ORDER BY id ASC
                    LIMIT ?
                    "#,
            )
            .bind(&options.from)
            .bind(prev_id)
            .bind(batch_size as i64)
            .fetch_all(pool)
            .await
            .map_err(|e| StorageError::Config(format!("Database query error: {}", e)))?,
        };

        if batch_rows.is_empty() {
            break;
        }

        if let Some(last_row) = batch_rows.last() {
            last_id = Some(last_row.id.clone());
        }

        let current_batch_size = batch_rows.len();
        batch_num += 1;

        let dry_run = options.dry_run;
        let delete_source = options.delete_source;
        let dest_backend_name = options.to.clone();

        let outcomes = stream::iter(batch_rows)
            .map(|row| {
                let source = Arc::clone(&source);
                let destination = Arc::clone(&destination);
                let dest_backend_name = dest_backend_name.clone();
                let pool = pool.clone();

                async move {
                    if dry_run {
                        return MigrationOutcome::Migrated {
                            bytes: row.padded_size.max(0) as u64,
                        };
                    }

                    // 1. Read from source
                    let bytes = match source.read(&row.storage_key).await {
                        Ok(b) => b,
                        Err(e) => {
                            return MigrationOutcome::Failed(MigrationFailure {
                                attachment_id: row.id,
                                reason: format!("source read failed: {}", e),
                            });
                        }
                    };

                    // 2. Verify source read hash
                    let computed_source_hash = hex::encode(Sha256::digest(&bytes));
                    if computed_source_hash != row.id {
                        return MigrationOutcome::Failed(MigrationFailure {
                            attachment_id: row.id,
                            reason: "source hash mismatch".to_string(),
                        });
                    }

                    // 3. Write to destination
                    if let Err(e) = destination.write(&row.storage_key, &bytes).await {
                        return MigrationOutcome::Failed(MigrationFailure {
                            attachment_id: row.id,
                            reason: format!("destination write failed: {}", e),
                        });
                    }

                    // 4. Verify destination write
                    let dest_bytes = match destination.read(&row.storage_key).await {
                        Ok(b) => b,
                        Err(e) => {
                            return MigrationOutcome::Failed(MigrationFailure {
                                attachment_id: row.id,
                                reason: format!("destination read verification failed: {}", e),
                            });
                        }
                    };

                    let computed_dest_hash = hex::encode(Sha256::digest(&dest_bytes));
                    if computed_dest_hash != row.id {
                        return MigrationOutcome::Failed(MigrationFailure {
                            attachment_id: row.id,
                            reason: "destination hash mismatch".to_string(),
                        });
                    }

                    // 5. Update row in database
                    let update_res = sqlx::query(
                        "UPDATE attachments SET storage_backend = ?, storage_key = ? WHERE id = ?",
                    )
                    .bind(&dest_backend_name)
                    .bind(&row.storage_key)
                    .bind(&row.id)
                    .execute(&pool)
                    .await;

                    if let Err(e) = update_res {
                        return MigrationOutcome::Failed(MigrationFailure {
                            attachment_id: row.id,
                            reason: format!("db update failed: {}", e),
                        });
                    }

                    // 6. Delete from source if requested
                    if delete_source {
                        if let Err(e) = source.delete(&row.storage_key).await {
                            warn!(
                                attachment_id = %row.id,
                                storage_key = %row.storage_key,
                                error = %e,
                                "Failed to delete source blob after migration"
                            );
                        }
                    }

                    MigrationOutcome::Migrated {
                        bytes: bytes.len() as u64,
                    }
                }
            })
            .buffer_unordered(concurrency)
            .collect::<Vec<MigrationOutcome>>()
            .await;

        let mut batch_processed = 0u64;
        let mut batch_migrated = 0u64;
        let mut batch_failed = 0u64;
        let mut batch_bytes = 0u64;

        for outcome in outcomes {
            batch_processed += 1;
            match outcome {
                MigrationOutcome::Migrated { bytes } => {
                    batch_migrated += 1;
                    batch_bytes += bytes;
                }
                MigrationOutcome::Failed(failure) => {
                    batch_failed += 1;
                    if failures.len() < 100 {
                        failures.push(failure);
                    } else {
                        warn!(
                            attachment_id = %failure.attachment_id,
                            reason = %failure.reason,
                            "Migration failure (failure list full)"
                        );
                    }
                }
            }
        }

        progress.processed += batch_processed;
        progress.migrated += batch_migrated;
        progress.failed += batch_failed;
        progress.bytes_transferred += batch_bytes;

        info!(
            "storage migrate batch={} processed={} migrated={} skipped=0 failed={} bytes={}",
            batch_num, batch_processed, batch_migrated, batch_failed, batch_bytes
        );

        if current_batch_size < batch_size {
            break;
        }
    }

    let finished_at = Utc::now();
    let duration_s = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;
    info!(
        "storage migrate complete total={} migrated={} failed={} bytes={} duration_s={:.1}",
        progress.total, progress.migrated, progress.failed, progress.bytes_transferred, duration_s
    );

    Ok(MigrationReport {
        progress,
        failures,
        started_at,
        finished_at,
    })
}
