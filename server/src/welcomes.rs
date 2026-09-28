use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use ulid::Ulid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WelcomeView {
    pub id: String,
    pub room_id: String,
    pub recipient_user_id: String,
    pub recipient_client_id: String,
    pub created_at: DateTime<Utc>,
    pub consumed: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum WelcomeError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("welcome not found")]
    NotFound,
    #[error("welcome already consumed")]
    AlreadyConsumed,
}

pub async fn create_welcome(
    conn: &mut sqlx::SqliteConnection,
    room_id: &str,
    recipient_user_id: &str,
    recipient_client_id: &str,
    welcome_data: &[u8],
) -> Result<(), WelcomeError> {
    let id = Ulid::new().to_string();

    sqlx::query(
        r#"
        INSERT INTO welcomes (id, room_id, recipient_user_id, recipient_client_id, welcome_data, consumed)
        VALUES (?, ?, ?, ?, ?, 0)
        "#,
    )
    .bind(id)
    .bind(room_id)
    .bind(recipient_user_id)
    .bind(recipient_client_id)
    .bind(welcome_data)
    .execute(conn)
    .await?;

    Ok(())
}

pub async fn list_pending(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<WelcomeView>, WelcomeError> {
    let rows = sqlx::query(
        r#"
        SELECT w.id, w.room_id, w.recipient_user_id, w.recipient_client_id, w.created_at, w.consumed
        FROM welcomes w
        JOIN rooms r ON r.id = w.room_id
        WHERE w.recipient_user_id = ? AND w.consumed = 0
        ORDER BY w.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let welcomes = rows
        .into_iter()
        .map(|row| WelcomeView {
            id: row.get("id"),
            room_id: row.get("room_id"),
            recipient_user_id: row.get("recipient_user_id"),
            recipient_client_id: row.get("recipient_client_id"),
            created_at: row.get("created_at"),
            consumed: row.get::<i64, _>("consumed") != 0,
        })
        .collect();

    Ok(welcomes)
}

pub async fn consume_welcome(
    pool: &SqlitePool,
    user_id: &str,
    welcome_id: &str,
) -> Result<WelcomeView, WelcomeError> {
    let mut tx = pool.begin().await?;

    let row_opt = sqlx::query(
        r#"
        SELECT w.id, w.room_id, w.recipient_user_id, w.recipient_client_id, w.created_at, w.consumed
        FROM welcomes w
        JOIN rooms r ON r.id = w.room_id
        WHERE w.id = ? AND w.recipient_user_id = ?
        "#,
    )
    .bind(welcome_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let row = match row_opt {
        Some(r) => r,
        None => return Err(WelcomeError::NotFound),
    };

    let consumed: bool = row.get::<i64, _>("consumed") != 0;
    if consumed {
        return Err(WelcomeError::AlreadyConsumed);
    }

    sqlx::query("UPDATE welcomes SET consumed = 1 WHERE id = ?")
        .bind(welcome_id)
        .execute(&mut *tx)
        .await?;

    let view = WelcomeView {
        id: row.get("id"),
        room_id: row.get("room_id"),
        recipient_user_id: row.get("recipient_user_id"),
        recipient_client_id: row.get("recipient_client_id"),
        created_at: row.get("created_at"),
        consumed: true,
    };

    tx.commit().await?;

    Ok(view)
}

pub async fn get_welcome_data(
    pool: &SqlitePool,
    user_id: &str,
    welcome_id: &str,
) -> Result<(WelcomeView, Vec<u8>), WelcomeError> {
    let row_opt = sqlx::query(
        r#"
        SELECT w.id, w.room_id, w.recipient_user_id, w.recipient_client_id, w.created_at, w.consumed, w.welcome_data
        FROM welcomes w
        JOIN rooms r ON r.id = w.room_id
        WHERE w.id = ? AND w.recipient_user_id = ?
        "#,
    )
    .bind(welcome_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let row = match row_opt {
        Some(r) => r,
        None => return Err(WelcomeError::NotFound),
    };

    let view = WelcomeView {
        id: row.get("id"),
        room_id: row.get("room_id"),
        recipient_user_id: row.get("recipient_user_id"),
        recipient_client_id: row.get("recipient_client_id"),
        created_at: row.get("created_at"),
        consumed: row.get::<i64, _>("consumed") != 0,
    };

    let welcome_data: Vec<u8> = row.get("welcome_data");

    Ok((view, welcome_data))
}
