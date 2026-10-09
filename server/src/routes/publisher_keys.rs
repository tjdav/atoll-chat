use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::auth::AuthUser;
use crate::bots::auth::CallerIdentity;
use crate::error::ApiError;
use crate::routes::bots::resolve_caller;
use crate::signing::{encode_publisher_key_signing_input, verify_publisher_key_signature};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct PublisherKeyQuery {
    pub epoch: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PublisherKeyResponse {
    pub room_id: String,
    pub epoch: u64,
    pub publisher_public_key: String,
    pub signer_user_id: String,
    pub signature: String,
}

#[derive(Debug, Deserialize)]
pub struct PublishPublisherKeyRequest {
    pub epoch: u64,
    pub publisher_public_key: String,
    pub signature: String,
}

fn no_store_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    headers
}

/// GET /rooms/:id/publisher-key
pub async fn get_publisher_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(room_id): Path<String>,
    Query(query): Query<PublisherKeyQuery>,
) -> Result<(HeaderMap, Json<PublisherKeyResponse>), ApiError> {
    // 1. Check room membership
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?)",
    )
    .bind(&room_id)
    .bind(&auth.user_id)
    .fetch_one(&state.pool)
    .await?;

    if !is_member {
        return Err(ApiError::NotFound("room_not_found".to_string()));
    }

    // 2. Resolve target epoch
    let target_epoch = match query.epoch {
        Some(ep) => ep,
        None => {
            let ep: Option<i64> =
                sqlx::query_scalar("SELECT epoch FROM room_epochs WHERE room_id = ?")
                    .bind(&room_id)
                    .fetch_optional(&state.pool)
                    .await?;
            match ep {
                Some(e) => e as u64,
                None => return Err(ApiError::NotFound("publisher_key_unavailable".to_string())),
            }
        }
    };

    // 3. Query room_publisher_keys for (room_id, target_epoch)
    let row = sqlx::query(
        r#"
        SELECT room_id, epoch, publisher_public_key, signer_user_id, signature
        FROM room_publisher_keys
        WHERE room_id = ? AND epoch = ?
        "#,
    )
    .bind(&room_id)
    .bind(target_epoch as i64)
    .fetch_optional(&state.pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("publisher_key_unavailable".to_string())),
    };

    let epoch_val: i64 = row.get("epoch");
    let pubkey_bytes: Vec<u8> = row.get("publisher_public_key");
    let signer_user_id: String = row.get("signer_user_id");
    let sig_bytes: Vec<u8> = row.get("signature");

    let response = PublisherKeyResponse {
        room_id,
        epoch: epoch_val as u64,
        publisher_public_key: URL_SAFE_NO_PAD.encode(pubkey_bytes),
        signer_user_id,
        signature: URL_SAFE_NO_PAD.encode(sig_bytes),
    };

    Ok((no_store_headers(), Json(response)))
}

/// POST /rooms/:id/publisher-key
pub async fn publish_publisher_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
    Json(body): Json<PublishPublisherKeyRequest>,
) -> Result<(HeaderMap, Json<PublisherKeyResponse>), ApiError> {
    // 1. Resolve caller and reject bot tokens
    let caller = resolve_caller(&state.pool, &headers, &state).await?;
    let user_id = match caller {
        CallerIdentity::User(auth) => auth.user_id,
        CallerIdentity::Bot(_) => {
            return Err(ApiError::Forbidden(
                "Only human members may publish publisher keys".to_string(),
            ));
        }
    };

    // 2. Check room membership
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?)",
    )
    .bind(&room_id)
    .bind(&user_id)
    .fetch_one(&state.pool)
    .await?;

    if !is_member {
        return Err(ApiError::Forbidden("not_a_member".to_string()));
    }

    // 3. Validate publisher_public_key (must decode to 32 bytes)
    let pubkey_bytes = URL_SAFE_NO_PAD
        .decode(&body.publisher_public_key)
        .map_err(|_| ApiError::BadRequest("invalid_publisher_public_key".to_string()))?;

    if pubkey_bytes.len() != 32 {
        return Err(ApiError::BadRequest(
            "invalid_publisher_public_key".to_string(),
        ));
    }

    let pubkey_array: [u8; 32] = pubkey_bytes
        .try_into()
        .map_err(|_| ApiError::BadRequest("invalid_publisher_public_key".to_string()))?;

    // 4. Validate signature (must decode to 64 bytes)
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(&body.signature)
        .map_err(|_| ApiError::BadRequest("invalid_signature".to_string()))?;

    if sig_bytes.len() != 64 {
        return Err(ApiError::BadRequest("invalid_signature".to_string()));
    }

    // 5. Load caller's identity_pubkey
    let identity_pubkey: Option<String> =
        sqlx::query_scalar("SELECT identity_pubkey FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_optional(&state.pool)
            .await?;

    let identity_pubkey = match identity_pubkey {
        Some(pk) if !pk.trim().is_empty() => pk,
        _ => return Err(ApiError::BadRequest("signature_invalid".to_string())),
    };

    // 6. Compute signing input & verify signature
    let signing_input = encode_publisher_key_signing_input(&room_id, body.epoch, &pubkey_array);

    verify_publisher_key_signature(&identity_pubkey, &signing_input, &body.signature)?;

    // 7. DB Storage & First-Publish-Wins per Epoch
    let mut tx = state.pool.begin().await?;

    let existing_epoch: Option<i64> =
        sqlx::query_scalar("SELECT epoch FROM room_publisher_keys WHERE room_id = ?")
            .bind(&room_id)
            .fetch_optional(&mut *tx)
            .await?;

    if let Some(stored_ep) = existing_epoch {
        if stored_ep == body.epoch as i64 {
            return Err(ApiError::Conflict("epoch_already_published".to_string()));
        }
    }

    sqlx::query(
        r#"
        INSERT INTO room_publisher_keys (room_id, epoch, publisher_public_key, signer_user_id, signature, published_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(room_id) DO UPDATE SET
            epoch = EXCLUDED.epoch,
            publisher_public_key = EXCLUDED.publisher_public_key,
            signer_user_id = EXCLUDED.signer_user_id,
            signature = EXCLUDED.signature,
            published_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&room_id)
    .bind(body.epoch as i64)
    .bind(&pubkey_array[..])
    .bind(&user_id)
    .bind(&sig_bytes[..])
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // 8. Event Fanout
    let event_payload = serde_json::json!({
        "room_id": room_id,
        "epoch": body.epoch,
        "publisher_public_key": body.publisher_public_key,
        "signer_user_id": user_id,
        "signature": body.signature,
    });

    // 8a. Room channel (best-effort)
    let room_channel = format!("private-room-{room_id}");
    let _ = state
        .publisher
        .publish(
            &room_channel,
            "room.publisher_key_updated",
            event_payload.clone(),
        )
        .await;

    // 8b. Signer's user channel (non-durable)
    let user_channel = format!("private-user-{user_id}");
    let _ = state
        .publisher
        .publish(
            &user_channel,
            "room.publisher_key_updated",
            event_payload.clone(),
        )
        .await;

    // 8c. Granted bot channels (non-durable)
    let active_bots: Vec<String> =
        sqlx::query_scalar("SELECT bot_id FROM room_bots WHERE room_id = ? AND revoked_at IS NULL")
            .bind(&room_id)
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();

    for bot_id in active_bots {
        let bot_channel = format!("private-bot-{bot_id}");
        let _ = state
            .publisher
            .publish(
                &bot_channel,
                "room.publisher_key_updated",
                event_payload.clone(),
            )
            .await;
    }

    let response = PublisherKeyResponse {
        room_id,
        epoch: body.epoch,
        publisher_public_key: body.publisher_public_key,
        signer_user_id: user_id,
        signature: body.signature,
    };

    Ok((no_store_headers(), Json(response)))
}
