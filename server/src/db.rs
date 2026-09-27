use crate::config::Config;
use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

pub async fn init_pool(config: &Config) -> anyhow::Result<SqlitePool> {
    if let Some(parent) = Path::new(&config.db_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create database directory: {:?}", parent))?;
        }
    }

    let connection_string = format!("sqlite://{}", config.db_path);

    let connect_options = SqliteConnectOptions::from_str(&connection_string)?
        .create_if_missing(true)
        .busy_timeout(Duration::from_millis(config.db_busy_timeout_ms))
        .pragma("journal_mode", "WAL")
        .pragma("foreign_keys", "ON");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .context("Failed to create SQLite pool")?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("Failed to run database migrations")?;

    Ok(pool)
}
