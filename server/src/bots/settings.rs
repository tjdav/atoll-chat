use crate::error::ApiError;
use crate::sockudo::Publisher;
use crate::sync::allocate_user_seq;
use axum::http::StatusCode;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BotSettingBotView {
    pub key: String,
    pub value_encrypted_bot: String,
    pub is_secret: bool,
    pub user_seq: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BotSettingOwnerView {
    pub key: String,
    pub value_encrypted_client: Option<String>,
    pub is_secret: bool,
    pub user_seq: i64,
}

#[derive(Debug, Deserialize)]
pub struct PatchBotSettingRequest {
    pub is_secret: bool,
    pub value_encrypted_bot: String,
    pub value_encrypted_client: Option<String>,
    pub ephemeral_pubkey: Option<String>,
}

fn decode_base64url(s: &str) -> Result<Vec<u8>, ()> {
    if let Ok(data) = URL_SAFE_NO_PAD.decode(s) {
        return Ok(data);
    }
    if let Ok(data) = URL_SAFE.decode(s) {
        return Ok(data);
    }
    Err(())
}

pub fn validate_setting_key(key: &str) -> Result<(), ApiError> {
    if key.is_empty() || key.len() > 256 {
        return Err(ApiError::BadRequest("invalid_setting_key".to_string()));
    }
    if key.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest("invalid_setting_key".to_string()));
    }
    Ok(())
}

pub async fn verify_bot_owner(
    pool: &SqlitePool,
    bot_id: &str,
    user_id: &str,
) -> Result<String, ApiError> {
    let row =
        sqlx::query("SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL")
            .bind(bot_id)
            .fetch_optional(pool)
            .await?;

    match row {
        Some(r) => {
            let owner_user_id: String = r.get("owner_user_id");
            if owner_user_id != user_id {
                return Err(ApiError::Forbidden("forbidden".to_string()));
            }
            Ok(owner_user_id)
        }
        None => Err(ApiError::NotFound("bot_not_found".to_string())),
    }
}

pub async fn get_bot_settings_for_bot(
    pool: &SqlitePool,
    bot_id: &str,
) -> Result<Vec<BotSettingBotView>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT key, value_encrypted_bot, is_secret, user_seq
        FROM bot_settings
        WHERE bot_id = ?
        ORDER BY key ASC
        "#,
    )
    .bind(bot_id)
    .fetch_all(pool)
    .await?;

    let settings = rows
        .into_iter()
        .map(|r| BotSettingBotView {
            key: r.get("key"),
            value_encrypted_bot: r.get("value_encrypted_bot"),
            is_secret: r.get::<i64, _>("is_secret") == 1,
            user_seq: r.get("user_seq"),
        })
        .collect();

    Ok(settings)
}

pub async fn get_bot_settings_for_owner(
    pool: &SqlitePool,
    bot_id: &str,
) -> Result<Vec<BotSettingOwnerView>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT key, value_encrypted_client, is_secret, user_seq
        FROM bot_settings
        WHERE bot_id = ?
        ORDER BY key ASC
        "#,
    )
    .bind(bot_id)
    .fetch_all(pool)
    .await?;

    let settings = rows
        .into_iter()
        .map(|r| BotSettingOwnerView {
            key: r.get("key"),
            value_encrypted_client: r.get("value_encrypted_client"),
            is_secret: r.get::<i64, _>("is_secret") == 1,
            user_seq: r.get("user_seq"),
        })
        .collect();

    Ok(settings)
}

pub async fn write_bot_setting(
    pool: &SqlitePool,
    publisher: &Publisher,
    owner_user_id: &str,
    bot_id: &str,
    key: &str,
    req: PatchBotSettingRequest,
    max_bytes: usize,
) -> Result<BotSettingOwnerView, ApiError> {
    validate_setting_key(key)?;

    if let Some(ref epk) = req.ephemeral_pubkey {
        let epk_bytes = decode_base64url(epk)
            .map_err(|_| ApiError::BadRequest("invalid_ephemeral_pubkey".to_string()))?;
        if epk_bytes.len() != 32 {
            return Err(ApiError::BadRequest("invalid_ephemeral_pubkey".to_string()));
        }
    }

    if req.value_encrypted_bot.is_empty() {
        return Err(ApiError::BadRequest(
            "invalid_value_encrypted_bot".to_string(),
        ));
    }

    let bot_ct_bytes = decode_base64url(&req.value_encrypted_bot)
        .map_err(|_| ApiError::BadRequest("invalid_value_encrypted_bot".to_string()))?;

    if bot_ct_bytes.len() < 60 {
        return Err(ApiError::BadRequest(
            "invalid_value_encrypted_bot".to_string(),
        ));
    }

    if bot_ct_bytes.len() > max_bytes {
        return Err(ApiError::CustomShape(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({
                "error": "value_too_large",
                "message": "Ciphertext exceeds maximum allowed bytes"
            }),
        ));
    }

    if req.is_secret {
        if req.value_encrypted_client.is_some() {
            return Err(ApiError::BadRequest(
                "client_ciphertext_forbidden".to_string(),
            ));
        }
    } else {
        match req.value_encrypted_client {
            None => {
                return Err(ApiError::BadRequest(
                    "client_ciphertext_required".to_string(),
                ));
            }
            Some(ref client_ct) => {
                if client_ct.is_empty() {
                    return Err(ApiError::BadRequest(
                        "invalid_value_encrypted_client".to_string(),
                    ));
                }
                let client_bytes = decode_base64url(client_ct).map_err(|_| {
                    ApiError::BadRequest("invalid_value_encrypted_client".to_string())
                })?;
                if client_bytes.len() > max_bytes {
                    return Err(ApiError::CustomShape(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        json!({
                            "error": "value_too_large",
                            "message": "Ciphertext exceeds maximum allowed bytes"
                        }),
                    ));
                }
            }
        }
    }

    let mut tx = pool.begin().await?;

    let existing_row = sqlx::query(
        r#"
        SELECT is_secret, value_encrypted_client, value_encrypted_bot, user_seq
        FROM bot_settings
        WHERE bot_id = ? AND key = ?
        "#,
    )
    .bind(bot_id)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(r) = existing_row {
        let ex_is_secret: bool = r.get::<i64, _>("is_secret") == 1;
        let ex_client_ct: Option<String> = r.get("value_encrypted_client");
        let ex_bot_ct: String = r.get("value_encrypted_bot");
        let ex_user_seq: i64 = r.get("user_seq");

        if ex_is_secret == req.is_secret
            && ex_client_ct == req.value_encrypted_client
            && ex_bot_ct == req.value_encrypted_bot
        {
            tx.commit().await?;
            return Ok(BotSettingOwnerView {
                key: key.to_string(),
                value_encrypted_client: req.value_encrypted_client,
                is_secret: req.is_secret,
                user_seq: ex_user_seq,
            });
        }
    }

    let user_seq = allocate_user_seq(&mut tx, owner_user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let is_secret_int: i64 = if req.is_secret { 1 } else { 0 };

    sqlx::query(
        r#"
        INSERT INTO bot_settings (
            bot_id, key, is_secret, value_encrypted_client, value_encrypted_bot, user_seq, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(bot_id, key) DO UPDATE SET
            is_secret = excluded.is_secret,
            value_encrypted_client = excluded.value_encrypted_client,
            value_encrypted_bot = excluded.value_encrypted_bot,
            user_seq = excluded.user_seq,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(bot_id)
    .bind(key)
    .bind(is_secret_int)
    .bind(&req.value_encrypted_client)
    .bind(&req.value_encrypted_bot)
    .bind(user_seq)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let user_payload = json!({
        "bot_id": bot_id,
        "key": key,
        "user_seq": user_seq
    });
    let _ = Publisher::publish(
        publisher,
        &format!("private-user-{}", owner_user_id),
        "bot_settings.updated",
        user_payload,
    )
    .await;

    let bot_payload = json!({
        "bot_id": bot_id,
        "keys_changed": [key],
        "user_seq": user_seq
    });
    let _ = Publisher::publish(
        publisher,
        &format!("private-bot-{}", bot_id),
        "bot.settings_updated",
        bot_payload,
    )
    .await;

    Ok(BotSettingOwnerView {
        key: key.to_string(),
        value_encrypted_client: req.value_encrypted_client,
        is_secret: req.is_secret,
        user_seq,
    })
}

pub async fn delete_bot_setting(
    pool: &SqlitePool,
    publisher: &Publisher,
    owner_user_id: &str,
    bot_id: &str,
    key: &str,
) -> Result<(), ApiError> {
    validate_setting_key(key)?;

    let mut tx = pool.begin().await?;

    let existing = sqlx::query("SELECT 1 FROM bot_settings WHERE bot_id = ? AND key = ?")
        .bind(bot_id)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?;

    if existing.is_none() {
        return Err(ApiError::NotFound("setting_not_found".to_string()));
    }

    let user_seq = allocate_user_seq(&mut tx, owner_user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    sqlx::query("DELETE FROM bot_settings WHERE bot_id = ? AND key = ?")
        .bind(bot_id)
        .bind(key)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let user_payload = json!({
        "bot_id": bot_id,
        "key": key,
        "user_seq": user_seq
    });
    let _ = Publisher::publish(
        publisher,
        &format!("private-user-{}", owner_user_id),
        "bot_settings.updated",
        user_payload,
    )
    .await;

    let bot_payload = json!({
        "bot_id": bot_id,
        "keys_changed": [key],
        "user_seq": user_seq
    });
    let _ = Publisher::publish(
        publisher,
        &format!("private-bot-{}", bot_id),
        "bot.settings_updated",
        bot_payload,
    )
    .await;

    Ok(())
}
