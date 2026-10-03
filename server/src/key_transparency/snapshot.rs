use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use ed25519_dalek::Signer;
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use ulid::Ulid;

use crate::config::Config;
use crate::key_transparency::merkle::{compute_root, LogLeaf};
use crate::key_transparency::signing::KeyTransparencyKeys;
use crate::opaque::OpaqueServer;
use crate::sockudo::Publisher;
use crate::sync::{allocate_user_seq, publish_user_event, UserEventEnvelope};

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotView {
    pub id: String,
    pub tree_size: i64,
    pub root_hash: String,
    pub signature: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, thiserror::Error)]
pub enum SnapshotError {
    #[error("key transparency is disabled")]
    Disabled,
    #[error("key derivation failed: {0}")]
    KeyDerivation(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// Computes signature input for snapshot: `I2OSP(tree_size, 8) || root_hash`.
pub fn format_signing_input(tree_size: u64, root_hash: &[u8; 32]) -> [u8; 40] {
    let mut input = [0u8; 40];
    input[..8].copy_from_slice(&tree_size.to_be_bytes());
    input[8..].copy_from_slice(root_hash);
    input
}

/// Executes snapshot creation logic:
/// 1. Verifies `KEY_TRANSPARENCY_ENABLED`.
/// 2. Queries log leaves ordered by `leaf_index ASC`.
/// 3. Computes `tree_size` and Merkle `root_hash`.
/// 4. Signs `I2OSP(tree_size, 8) || root_hash` with derived Ed25519 key.
/// 5. Inserts snapshot row into `key_transparency_snapshots`.
/// 6. Writes `kt.snapshot` audit log with metadata `{"tree_size": tree_size}`.
/// 7. Fans out `kt.snapshot` user event to all non-deleted users using `user_seq`.
pub async fn create_snapshot(
    pool: &SqlitePool,
    opaque_server: &OpaqueServer,
    publisher: &Publisher,
    config: &Config,
    actor_id: Option<&str>,
) -> Result<SnapshotView, SnapshotError> {
    if !config.key_transparency_enabled {
        return Err(SnapshotError::Disabled);
    }

    let kt_keys = KeyTransparencyKeys::derive(&opaque_server.setup)
        .map_err(|e| SnapshotError::KeyDerivation(e.to_string()))?;

    // 1. Fetch log leaves in leaf_index ASC order
    let rows = sqlx::query(
        "SELECT username_token, identity_pubkey FROM key_transparency_log ORDER BY leaf_index ASC",
    )
    .fetch_all(pool)
    .await?;

    let leaves: Vec<LogLeaf> = rows
        .into_iter()
        .map(|r| LogLeaf {
            username_token: r.get("username_token"),
            identity_pubkey: r.get("identity_pubkey"),
        })
        .collect();

    let tree_size = leaves.len() as u64;
    let root_hash = compute_root(&leaves);

    // 2. Sign signing input
    let signing_input = format_signing_input(tree_size, &root_hash);
    let signature = kt_keys.signing_key.sign(&signing_input);
    let signature_bytes = signature.to_bytes();

    let snapshot_id = Ulid::new().to_string();

    // 3. Insert snapshot row into DB
    let inserted_row = sqlx::query(
        r#"
        INSERT INTO key_transparency_snapshots (id, tree_size, root_hash, signature)
        VALUES (?, ?, ?, ?)
        RETURNING id, tree_size, root_hash, signature, created_at
        "#,
    )
    .bind(&snapshot_id)
    .bind(tree_size as i64)
    .bind(&root_hash[..])
    .bind(&signature_bytes[..])
    .fetch_one(pool)
    .await?;

    let created_at: DateTime<Utc> = inserted_row.get("created_at");

    // 4. Audit entry
    let _ = crate::audit::log(
        pool,
        actor_id,
        crate::audit::action::KT_SNAPSHOT,
        Some("key_transparency_snapshots"),
        Some(&snapshot_id),
        Some(serde_json::json!({ "tree_size": tree_size })),
    )
    .await;

    // 5. Fan out kt.snapshot user event per user
    let user_rows = sqlx::query("SELECT id FROM users WHERE deleted_at IS NULL")
        .fetch_all(pool)
        .await?;

    let event_payload = serde_json::json!({
        "tree_size": tree_size,
        "root_hash": URL_SAFE_NO_PAD.encode(root_hash),
        "created_at": created_at,
    });

    for user_row in user_rows {
        let user_id: String = user_row.get("id");

        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                tracing::warn!(user_id = %user_id, error = %e, "kt.snapshot fanout tx start failed");
                continue;
            }
        };

        let user_seq = match allocate_user_seq(&mut tx, &user_id).await {
            Ok(seq) => seq,
            Err(e) => {
                tracing::warn!(user_id = %user_id, error = %e, "kt.snapshot allocate_user_seq failed");
                let _ = tx.rollback().await;
                continue;
            }
        };

        if let Err(e) = tx.commit().await {
            tracing::warn!(user_id = %user_id, error = %e, "kt.snapshot user_seq commit failed");
            continue;
        }

        let envelope = UserEventEnvelope::new("kt.snapshot", user_seq, event_payload.clone());

        if let Err(e) = publish_user_event(publisher, &user_id, &envelope).await {
            tracing::warn!(user_id = %user_id, error = %e, "kt.snapshot publish event failed");
        }
    }

    Ok(SnapshotView {
        id: snapshot_id,
        tree_size: tree_size as i64,
        root_hash: URL_SAFE_NO_PAD.encode(root_hash),
        signature: URL_SAFE_NO_PAD.encode(signature_bytes),
        created_at,
    })
}
