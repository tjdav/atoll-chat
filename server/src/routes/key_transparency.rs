use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::key_transparency::merkle::{
    bot_leaf_hash, compute_root_from_hashes, generate_inclusion_proof_from_hashes, leaf_hash,
};
use crate::AppState;

#[derive(Serialize)]
pub struct UserKtResponse {
    pub user_id: String,
    pub leaf_index: i64,
    pub identity_pubkey: String,
    pub inclusion_proof: Vec<String>,
    pub tree_head: Value,
    pub auditor_signatures: Vec<Value>,
}

#[derive(Serialize)]
pub struct BotKtResponse {
    pub bot_id: String,
    pub leaf_index: i64,
    pub bot_identity_pubkey: String,
    pub bot_command_pubkey: String,
    pub identity_pubkey: String,
    pub inclusion_proof: Vec<String>,
    pub tree_head: Value,
    pub auditor_signatures: Vec<Value>,
}

#[derive(Serialize)]
pub struct BotKtHistoryEntry {
    pub leaf_index: i64,
    pub bot_identity_pubkey: String,
    pub bot_command_pubkey: String,
    pub identity_pubkey: String,
    pub added_at: String,
}

#[derive(Serialize)]
pub struct BotKtHistoryResponse {
    pub bot_id: String,
    pub entries: Vec<BotKtHistoryEntry>,
}

#[derive(Serialize)]
pub struct KtSnapshotResponse {
    pub tree_size: i64,
    pub root_hash: String,
    pub created_at: DateTime<Utc>,
}

/// GET /api/v1/kt/user/:id
pub async fn get_user_kt_handler(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(target_user_id): Path<String>,
) -> Result<(HeaderMap, Json<UserKtResponse>), ApiError> {
    if !state.config.key_transparency_enabled {
        return Err(ApiError::NotFound("key_transparency_disabled".to_string()));
    }

    // 1. Fetch all leaves in leaf_index ASC order to construct Merkle tree
    let rows = sqlx::query(
        r#"
        SELECT leaf_index, user_id, bot_id, username_token, bot_identity_pubkey, identity_pubkey, command_pubkey
        FROM key_transparency_log
        ORDER BY leaf_index ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let mut target_index_in_tree = None;
    let mut target_leaf_index_db = 0i64;
    let mut target_identity_pubkey = String::new();
    let mut leaf_hashes = Vec::with_capacity(rows.len());

    for (idx, row) in rows.iter().enumerate() {
        let user_id: Option<String> = row.get("user_id");
        let _bot_id: Option<String> = row.get("bot_id");
        let username_token: Option<String> = row.get("username_token");
        let bot_identity_pubkey: Option<String> = row.get("bot_identity_pubkey");
        let identity_pubkey: Option<String> = row.get("identity_pubkey");
        let command_pubkey: Option<String> = row.get("command_pubkey");
        let leaf_index: i64 = row.get("leaf_index");

        if user_id.as_deref() == Some(&target_user_id) {
            target_index_in_tree = Some(idx);
            target_leaf_index_db = leaf_index;
            target_identity_pubkey = identity_pubkey.clone().unwrap_or_default();
        }

        let hash = if let (Some(token), Some(pubkey)) =
            (username_token.as_ref(), identity_pubkey.as_ref())
        {
            if user_id.is_some() {
                leaf_hash(token, pubkey)
            } else {
                [0u8; 32]
            }
        } else if let (Some(b_pub), Some(c_pub), Some(i_pub)) = (
            bot_identity_pubkey.as_ref(),
            command_pubkey.as_ref(),
            identity_pubkey.as_ref(),
        ) {
            bot_leaf_hash(b_pub, c_pub, i_pub)
        } else {
            [0u8; 32]
        };

        leaf_hashes.push(hash);
    }

    let pos =
        target_index_in_tree.ok_or_else(|| ApiError::NotFound("user_not_found".to_string()))?;

    // 2. Compute inclusion proof for target position
    let proof = generate_inclusion_proof_from_hashes(&leaf_hashes, pos).map_err(|e| {
        ApiError::Internal(anyhow::anyhow!("failed to generate inclusion proof: {}", e))
    })?;

    let inclusion_proof: Vec<String> = proof.iter().map(|h| URL_SAFE_NO_PAD.encode(h)).collect();

    let root_hash = compute_root_from_hashes(&leaf_hashes);
    let current_tree_size = leaf_hashes.len() as i64;

    // 3. Query latest snapshot from DB
    let snapshot_row = sqlx::query(
        "SELECT id, tree_size, root_hash, signature, created_at FROM key_transparency_snapshots ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await?;

    let tree_head = if let Some(row) = snapshot_row {
        let snap_tree_size: i64 = row.get("tree_size");
        if snap_tree_size == current_tree_size {
            let id: String = row.get("id");
            let root_bytes: Vec<u8> = row.get("root_hash");
            let sig_bytes: Option<Vec<u8>> = row.get("signature");
            let created_at: DateTime<Utc> = row.get("created_at");
            json!({
                "id": id,
                "tree_size": snap_tree_size,
                "root_hash": URL_SAFE_NO_PAD.encode(&root_bytes),
                "signature": sig_bytes.map(|s| URL_SAFE_NO_PAD.encode(&s)),
                "created_at": created_at,
            })
        } else {
            json!({
                "tree_size": current_tree_size,
                "root_hash": URL_SAFE_NO_PAD.encode(root_hash),
                "created_at": Utc::now(),
            })
        }
    } else {
        json!({
            "tree_size": current_tree_size,
            "root_hash": URL_SAFE_NO_PAD.encode(root_hash),
            "created_at": Utc::now(),
        })
    };

    let response = UserKtResponse {
        user_id: target_user_id,
        leaf_index: target_leaf_index_db,
        identity_pubkey: target_identity_pubkey,
        inclusion_proof,
        tree_head,
        auditor_signatures: Vec::new(),
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(response)))
}

/// GET /api/v1/kt/bot/:id
pub async fn get_bot_kt_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(target_bot_id): Path<String>,
) -> Result<(HeaderMap, Json<BotKtResponse>), ApiError> {
    if !state.config.key_transparency_enabled {
        return Err(ApiError::NotFound("key_transparency_disabled".to_string()));
    }

    let _caller = crate::routes::bots::resolve_caller(&state.pool, &headers, &state).await?;

    let rows = sqlx::query(
        r#"
        SELECT leaf_index, user_id, bot_id, username_token, bot_identity_pubkey, identity_pubkey, command_pubkey
        FROM key_transparency_log
        ORDER BY leaf_index ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let mut target_index_in_tree = None;
    let mut target_leaf_index_db = 0i64;
    let mut target_bot_identity_pubkey = String::new();
    let mut target_bot_command_pubkey = String::new();
    let mut target_identity_pubkey = String::new();
    let mut leaf_hashes = Vec::with_capacity(rows.len());

    for (idx, row) in rows.iter().enumerate() {
        let user_id: Option<String> = row.get("user_id");
        let bot_id: Option<String> = row.get("bot_id");
        let username_token: Option<String> = row.get("username_token");
        let bot_identity_pubkey: Option<String> = row.get("bot_identity_pubkey");
        let identity_pubkey: Option<String> = row.get("identity_pubkey");
        let command_pubkey: Option<String> = row.get("command_pubkey");
        let leaf_index: i64 = row.get("leaf_index");

        if bot_id.as_deref() == Some(&target_bot_id) {
            target_index_in_tree = Some(idx);
            target_leaf_index_db = leaf_index;
            target_bot_identity_pubkey = bot_identity_pubkey.clone().unwrap_or_default();
            target_bot_command_pubkey = command_pubkey.clone().unwrap_or_default();
            target_identity_pubkey = identity_pubkey.clone().unwrap_or_default();
        }

        let hash = if let (Some(token), Some(pubkey)) =
            (username_token.as_ref(), identity_pubkey.as_ref())
        {
            if user_id.is_some() {
                leaf_hash(token, pubkey)
            } else {
                [0u8; 32]
            }
        } else if let (Some(b_pub), Some(c_pub), Some(i_pub)) = (
            bot_identity_pubkey.as_ref(),
            command_pubkey.as_ref(),
            identity_pubkey.as_ref(),
        ) {
            bot_leaf_hash(b_pub, c_pub, i_pub)
        } else {
            [0u8; 32]
        };

        leaf_hashes.push(hash);
    }

    let pos =
        target_index_in_tree.ok_or_else(|| ApiError::NotFound("bot_not_found".to_string()))?;

    let proof = generate_inclusion_proof_from_hashes(&leaf_hashes, pos).map_err(|e| {
        ApiError::Internal(anyhow::anyhow!("failed to generate inclusion proof: {}", e))
    })?;

    let inclusion_proof: Vec<String> = proof.iter().map(|h| URL_SAFE_NO_PAD.encode(h)).collect();

    let root_hash = compute_root_from_hashes(&leaf_hashes);
    let current_tree_size = leaf_hashes.len() as i64;

    let snapshot_row = sqlx::query(
        "SELECT id, tree_size, root_hash, signature, created_at FROM key_transparency_snapshots ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await?;

    let tree_head = if let Some(row) = snapshot_row {
        let snap_tree_size: i64 = row.get("tree_size");
        if snap_tree_size == current_tree_size {
            let id: String = row.get("id");
            let root_bytes: Vec<u8> = row.get("root_hash");
            let sig_bytes: Option<Vec<u8>> = row.get("signature");
            let created_at: DateTime<Utc> = row.get("created_at");
            json!({
                "id": id,
                "tree_size": snap_tree_size,
                "root_hash": URL_SAFE_NO_PAD.encode(&root_bytes),
                "signature": sig_bytes.map(|s| URL_SAFE_NO_PAD.encode(&s)),
                "created_at": created_at,
            })
        } else {
            json!({
                "tree_size": current_tree_size,
                "root_hash": URL_SAFE_NO_PAD.encode(root_hash),
                "created_at": Utc::now(),
            })
        }
    } else {
        json!({
            "tree_size": current_tree_size,
            "root_hash": URL_SAFE_NO_PAD.encode(root_hash),
            "created_at": Utc::now(),
        })
    };

    let response = BotKtResponse {
        bot_id: target_bot_id,
        leaf_index: target_leaf_index_db,
        bot_identity_pubkey: target_bot_identity_pubkey,
        bot_command_pubkey: target_bot_command_pubkey,
        identity_pubkey: target_identity_pubkey,
        inclusion_proof,
        tree_head,
        auditor_signatures: Vec::new(),
    };

    let mut res_headers = HeaderMap::new();
    res_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((res_headers, Json(response)))
}

/// GET /api/v1/kt/bot/:id/history
pub async fn get_bot_kt_history_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(target_bot_id): Path<String>,
) -> Result<(HeaderMap, Json<BotKtHistoryResponse>), ApiError> {
    if !state.config.key_transparency_enabled {
        return Err(ApiError::NotFound("key_transparency_disabled".to_string()));
    }

    let _caller = crate::routes::bots::resolve_caller(&state.pool, &headers, &state).await?;

    let rows = sqlx::query(
        r#"
        SELECT leaf_index, bot_identity_pubkey, command_pubkey, identity_pubkey, CAST(added_at AS TEXT) AS added_at
        FROM key_transparency_log
        WHERE bot_id = ?
        ORDER BY leaf_index ASC
        "#,
    )
    .bind(&target_bot_id)
    .fetch_all(&state.pool)
    .await?;

    if rows.is_empty() {
        return Err(ApiError::NotFound("bot_not_found".to_string()));
    }

    let entries = rows
        .into_iter()
        .map(|row| BotKtHistoryEntry {
            leaf_index: row.get("leaf_index"),
            bot_identity_pubkey: row
                .get::<Option<String>, _>("bot_identity_pubkey")
                .unwrap_or_default(),
            bot_command_pubkey: row
                .get::<Option<String>, _>("command_pubkey")
                .unwrap_or_default(),
            identity_pubkey: row
                .get::<Option<String>, _>("identity_pubkey")
                .unwrap_or_default(),
            added_at: row.get("added_at"),
        })
        .collect();

    let response = BotKtHistoryResponse {
        bot_id: target_bot_id,
        entries,
    };

    let mut res_headers = HeaderMap::new();
    res_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((res_headers, Json(response)))
}

/// GET /api/v1/kt/snapshot
pub async fn get_kt_snapshot_handler(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<(HeaderMap, Json<KtSnapshotResponse>), ApiError> {
    if !state.config.key_transparency_enabled {
        return Err(ApiError::NotFound("key_transparency_disabled".to_string()));
    }

    let row = sqlx::query(
        "SELECT tree_size, root_hash, created_at FROM key_transparency_snapshots ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::NotFound("snapshot_not_found".to_string()))?;

    let tree_size: i64 = row.get("tree_size");
    let root_hash_bytes: Vec<u8> = row.get("root_hash");
    let created_at: DateTime<Utc> = row.get("created_at");

    let response = KtSnapshotResponse {
        tree_size,
        root_hash: URL_SAFE_NO_PAD.encode(&root_hash_bytes),
        created_at,
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(response)))
}
