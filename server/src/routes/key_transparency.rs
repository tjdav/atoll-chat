use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use utoipa::ToSchema;

use crate::auth::AuthUser;
use crate::error::{ApiError, ErrorResponse};
use crate::key_transparency::merkle::{
    bot_leaf_hash, compute_root_from_hashes, generate_inclusion_proof_from_hashes, leaf_hash,
};
use crate::AppState;

#[derive(Serialize, ToSchema)]
pub struct KtTreeHead {
    pub id: Option<String>,
    pub tree_size: i64,
    /// 32-byte Merkle tree root hash, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub root_hash: String,
    /// Server signature over tree head, base64url encoded.
    #[schema(value_type = Option<String>, format = Binary)]
    pub signature: Option<String>,
    #[schema(value_type = String, example = "2026-10-12T00:00:00Z")]
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub struct KtAuditorSignature {
    pub auditor_id: String,
    /// Auditor signature over tree head, base64url encoded.
    #[schema(value_type = String, format = Binary)]
    pub signature: String,
}

#[derive(Serialize, ToSchema)]
pub struct UserKtResponse {
    pub user_id: String,
    pub leaf_index: i64,
    /// 32-byte leaf hash SHA-256(0x00 || serialized_leaf), base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub leaf_hash: String,
    /// User Ed25519 identity public key, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub identity_pubkey: String,
    /// Merkle inclusion proof hashes, base64url encoded.
    #[schema(value_type = Vec<String>)]
    pub inclusion_proof: Vec<String>,
    pub tree_head: KtTreeHead,
    pub auditor_signatures: Vec<KtAuditorSignature>,
}

#[derive(Serialize, ToSchema)]
pub struct BotKtResponse {
    pub bot_id: String,
    pub leaf_index: i64,
    /// 32-byte leaf hash SHA-256(0x00 || serialized_leaf), base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub leaf_hash: String,
    /// Bot identity public key, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub bot_identity_pubkey: String,
    /// Bot command public key, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub bot_command_pubkey: String,
    /// Bot operator Ed25519 identity public key, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub identity_pubkey: String,
    /// Merkle inclusion proof hashes, base64url encoded.
    #[schema(value_type = Vec<String>)]
    pub inclusion_proof: Vec<String>,
    pub tree_head: KtTreeHead,
    pub auditor_signatures: Vec<KtAuditorSignature>,
}

#[derive(Serialize, ToSchema)]
pub struct BotKtHistoryEntry {
    pub leaf_index: i64,
    /// 32-byte leaf hash SHA-256(0x00 || serialized_leaf), base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub leaf_hash: String,
    /// Bot identity public key, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub bot_identity_pubkey: String,
    /// Bot command public key, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub bot_command_pubkey: String,
    /// Bot operator Ed25519 identity public key, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub identity_pubkey: String,
    pub added_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct BotKtHistoryResponse {
    pub bot_id: String,
    pub entries: Vec<BotKtHistoryEntry>,
}

#[derive(Serialize, ToSchema)]
pub struct KtSnapshotResponse {
    pub tree_size: i64,
    /// 32-byte Merkle tree root hash, base64url encoded. Reference: §7.11
    #[schema(value_type = String, format = Binary)]
    pub root_hash: String,
    /// Server signature over snapshot (I2OSP(tree_size, 8) || root_hash), base64url encoded. Reference: §8.11.4
    #[schema(value_type = Option<String>, format = Binary)]
    pub signature: Option<String>,
    #[schema(value_type = String, example = "2026-10-12T00:00:00Z")]
    pub created_at: DateTime<Utc>,
}

/// GET /api/v1/kt/user/:id
#[utoipa::path(
    get,
    path = "/api/v1/kt/user/{id}",
    tag = "Key Transparency",
    summary = "Current user keys with inclusion proof",
    description = "Fetches current user public key and Merkle inclusion proof. See §8.11.1. Note: username_token is excluded from response per §12.",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target user ID")
    ),
    responses(
        (status = 200, description = "User Key Transparency entry retrieved successfully", body = UserKtResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "User not found or Key Transparency disabled", body = ErrorResponse)
    )
)]
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
        SELECT leaf_index, user_id, bot_id, username_token, bot_identity_pubkey, identity_pubkey, command_pubkey, leaf_hash
        FROM key_transparency_log
        ORDER BY leaf_index ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let mut target_index_in_tree = None;
    let mut target_leaf_index_db = 0i64;
    let mut target_identity_pubkey = String::new();
    let mut target_leaf_hash_bytes = Vec::new();
    let mut leaf_hashes = Vec::with_capacity(rows.len());

    for (idx, row) in rows.iter().enumerate() {
        let user_id: Option<String> = row.get("user_id");
        let _bot_id: Option<String> = row.get("bot_id");
        let username_token: Option<String> = row.get("username_token");
        let bot_identity_pubkey: Option<String> = row.get("bot_identity_pubkey");
        let identity_pubkey: Option<String> = row.get("identity_pubkey");
        let command_pubkey: Option<String> = row.get("command_pubkey");
        let leaf_index: i64 = row.get("leaf_index");
        let stored_leaf_hash: Option<Vec<u8>> = row.get("leaf_hash");

        let hash = if let Some(ref lh) = stored_leaf_hash {
            let mut arr = [0u8; 32];
            if lh.len() == 32 {
                arr.copy_from_slice(lh);
                arr
            } else if let (Some(token), Some(pubkey)) =
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
            }
        } else if let (Some(token), Some(pubkey)) =
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

        if user_id.as_deref() == Some(&target_user_id) {
            target_index_in_tree = Some(idx);
            target_leaf_index_db = leaf_index;
            target_identity_pubkey = identity_pubkey.clone().unwrap_or_default();
            target_leaf_hash_bytes = hash.to_vec();
        }

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
            KtTreeHead {
                id: Some(id),
                tree_size: snap_tree_size,
                root_hash: URL_SAFE_NO_PAD.encode(&root_bytes),
                signature: sig_bytes.map(|s| URL_SAFE_NO_PAD.encode(&s)),
                created_at,
            }
        } else {
            KtTreeHead {
                id: None,
                tree_size: current_tree_size,
                root_hash: URL_SAFE_NO_PAD.encode(root_hash),
                signature: None,
                created_at: Utc::now(),
            }
        }
    } else {
        KtTreeHead {
            id: None,
            tree_size: current_tree_size,
            root_hash: URL_SAFE_NO_PAD.encode(root_hash),
            signature: None,
            created_at: Utc::now(),
        }
    };

    let response = UserKtResponse {
        user_id: target_user_id,
        leaf_index: target_leaf_index_db,
        leaf_hash: URL_SAFE_NO_PAD.encode(&target_leaf_hash_bytes),
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
#[utoipa::path(
    get,
    path = "/api/v1/kt/bot/{id}",
    tag = "Key Transparency",
    summary = "Current bot keys with inclusion proof",
    description = "Fetches current bot identity and command keys with Merkle inclusion proof. See §8.11.2.",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target bot ID")
    ),
    responses(
        (status = 200, description = "Bot Key Transparency entry retrieved successfully", body = BotKtResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Bot not found or Key Transparency disabled", body = ErrorResponse)
    )
)]
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
        SELECT leaf_index, user_id, bot_id, username_token, bot_identity_pubkey, identity_pubkey, command_pubkey, leaf_hash
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
    let mut target_leaf_hash_bytes = Vec::new();
    let mut leaf_hashes = Vec::with_capacity(rows.len());

    for (idx, row) in rows.iter().enumerate() {
        let user_id: Option<String> = row.get("user_id");
        let bot_id: Option<String> = row.get("bot_id");
        let username_token: Option<String> = row.get("username_token");
        let bot_identity_pubkey: Option<String> = row.get("bot_identity_pubkey");
        let identity_pubkey: Option<String> = row.get("identity_pubkey");
        let command_pubkey: Option<String> = row.get("command_pubkey");
        let leaf_index: i64 = row.get("leaf_index");
        let stored_leaf_hash: Option<Vec<u8>> = row.get("leaf_hash");

        let hash = if let Some(ref lh) = stored_leaf_hash {
            let mut arr = [0u8; 32];
            if lh.len() == 32 {
                arr.copy_from_slice(lh);
                arr
            } else if let (Some(token), Some(pubkey)) =
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
            }
        } else if let (Some(token), Some(pubkey)) =
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

        if bot_id.as_deref() == Some(&target_bot_id) {
            target_index_in_tree = Some(idx);
            target_leaf_index_db = leaf_index;
            target_bot_identity_pubkey = bot_identity_pubkey.clone().unwrap_or_default();
            target_bot_command_pubkey = command_pubkey.clone().unwrap_or_default();
            target_identity_pubkey = identity_pubkey.clone().unwrap_or_default();
            target_leaf_hash_bytes = hash.to_vec();
        }

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
            KtTreeHead {
                id: Some(id),
                tree_size: snap_tree_size,
                root_hash: URL_SAFE_NO_PAD.encode(&root_bytes),
                signature: sig_bytes.map(|s| URL_SAFE_NO_PAD.encode(&s)),
                created_at,
            }
        } else {
            KtTreeHead {
                id: None,
                tree_size: current_tree_size,
                root_hash: URL_SAFE_NO_PAD.encode(root_hash),
                signature: None,
                created_at: Utc::now(),
            }
        }
    } else {
        KtTreeHead {
            id: None,
            tree_size: current_tree_size,
            root_hash: URL_SAFE_NO_PAD.encode(root_hash),
            signature: None,
            created_at: Utc::now(),
        }
    };

    let response = BotKtResponse {
        bot_id: target_bot_id,
        leaf_index: target_leaf_index_db,
        leaf_hash: URL_SAFE_NO_PAD.encode(&target_leaf_hash_bytes),
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
#[utoipa::path(
    get,
    path = "/api/v1/kt/bot/{id}/history",
    tag = "Key Transparency",
    summary = "All bot key history",
    description = "Fetches all historical key entries for a bot ordered by leaf_index ASC without inclusion proofs. See §8.11.3.",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target bot ID")
    ),
    responses(
        (status = 200, description = "Bot Key Transparency history retrieved successfully", body = BotKtHistoryResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Bot not found or Key Transparency disabled", body = ErrorResponse)
    )
)]
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
        SELECT leaf_index, bot_identity_pubkey, command_pubkey, identity_pubkey, leaf_hash, CAST(added_at AS TEXT) AS added_at
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
        .map(|row| {
            let b_pub: String = row
                .get::<Option<String>, _>("bot_identity_pubkey")
                .unwrap_or_default();
            let c_pub: String = row
                .get::<Option<String>, _>("command_pubkey")
                .unwrap_or_default();
            let i_pub: String = row
                .get::<Option<String>, _>("identity_pubkey")
                .unwrap_or_default();
            let stored_leaf_hash: Option<Vec<u8>> = row.get("leaf_hash");

            let hash_bytes = if let Some(lh) = stored_leaf_hash {
                if lh.len() == 32 {
                    lh
                } else {
                    bot_leaf_hash(&b_pub, &c_pub, &i_pub).to_vec()
                }
            } else {
                bot_leaf_hash(&b_pub, &c_pub, &i_pub).to_vec()
            };

            BotKtHistoryEntry {
                leaf_index: row.get("leaf_index"),
                leaf_hash: URL_SAFE_NO_PAD.encode(&hash_bytes),
                bot_identity_pubkey: b_pub,
                bot_command_pubkey: c_pub,
                identity_pubkey: i_pub,
                added_at: row.get("added_at"),
            }
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
#[utoipa::path(
    get,
    path = "/api/v1/kt/snapshot",
    tag = "Key Transparency",
    summary = "Current KT snapshot",
    description = "Fetches current Key Transparency tree head snapshot on demand. See §8.11.4.",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Key Transparency snapshot retrieved successfully", body = KtSnapshotResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Snapshot not found or Key Transparency disabled", body = ErrorResponse)
    )
)]
pub async fn get_kt_snapshot_handler(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<(HeaderMap, Json<KtSnapshotResponse>), ApiError> {
    if !state.config.key_transparency_enabled {
        return Err(ApiError::NotFound("key_transparency_disabled".to_string()));
    }

    let row = sqlx::query(
        "SELECT tree_size, root_hash, signature, created_at FROM key_transparency_snapshots ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::NotFound("snapshot_not_found".to_string()))?;

    let tree_size: i64 = row.get("tree_size");
    let root_hash_bytes: Vec<u8> = row.get("root_hash");
    let sig_bytes: Option<Vec<u8>> = row.get("signature");
    let created_at: DateTime<Utc> = row.get("created_at");

    let response = KtSnapshotResponse {
        tree_size,
        root_hash: URL_SAFE_NO_PAD.encode(&root_hash_bytes),
        signature: sig_bytes.map(|s| URL_SAFE_NO_PAD.encode(&s)),
        created_at,
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(response)))
}
