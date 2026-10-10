use sqlx::{Row, SqliteConnection};

pub const ENDPOINT_BOT_MESSAGES: &str = "bot-messages";
pub const ENDPOINT_BOT_COMMANDS: &str = "bot-commands";

#[derive(Debug, PartialEq, Eq)]
pub enum IdempotencyOutcome {
    Reserved,
    Duplicate { response_code: u16 },
    Conflict,
}

pub fn validate_request_id(request_id: &str) -> bool {
    let trimmed = request_id.trim();
    !trimmed.is_empty() && trimmed.len() <= 128 && trimmed.bytes().all(|b| (32..=126).contains(&b))
}

pub async fn check_or_reserve_request_id(
    tx: &mut SqliteConnection,
    bot_id: &str,
    request_id: &str,
    endpoint: &str,
) -> Result<IdempotencyOutcome, sqlx::Error> {
    let existing = sqlx::query(
        "SELECT endpoint, response_code FROM bot_request_log WHERE bot_id = ? AND request_id = ?",
    )
    .bind(bot_id)
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(row) = existing {
        let stored_endpoint: String = row.get("endpoint");
        let stored_code: i64 = row.get("response_code");

        if stored_endpoint != endpoint {
            return Ok(IdempotencyOutcome::Conflict);
        }

        if stored_code == 0 {
            return Ok(IdempotencyOutcome::Reserved);
        }

        return Ok(IdempotencyOutcome::Duplicate {
            response_code: stored_code as u16,
        });
    }

    sqlx::query(
        "INSERT INTO bot_request_log (bot_id, request_id, endpoint, response_code) VALUES (?, ?, ?, 0)",
    )
    .bind(bot_id)
    .bind(request_id)
    .bind(endpoint)
    .execute(&mut *tx)
    .await?;

    Ok(IdempotencyOutcome::Reserved)
}

pub async fn record_response_code(
    tx: &mut SqliteConnection,
    bot_id: &str,
    request_id: &str,
    response_code: u16,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE bot_request_log SET response_code = ? WHERE bot_id = ? AND request_id = ?")
        .bind(response_code as i64)
        .bind(bot_id)
        .bind(request_id)
        .execute(&mut *tx)
        .await?;

    Ok(())
}
