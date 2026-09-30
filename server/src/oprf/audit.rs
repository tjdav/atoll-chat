use sqlx::SqlitePool;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use super::keys::OprfError;

pub struct OprfAuditCounter {
    counter: AtomicU64,
    last_flush: Mutex<Instant>,
}

impl Default for OprfAuditCounter {
    fn default() -> Self {
        Self::new()
    }
}

impl OprfAuditCounter {
    pub fn new() -> Self {
        Self {
            counter: AtomicU64::new(0),
            last_flush: Mutex::new(Instant::now()),
        }
    }

    pub fn record(&self) {
        self.counter.fetch_add(1, Ordering::Relaxed);
    }

    pub fn counter(&self) -> u64 {
        self.counter.load(Ordering::Relaxed)
    }

    pub fn set_last_flush_elapsed_secs(&self, secs: u64) {
        if let Ok(mut lock) = self.last_flush.lock() {
            *lock = Instant::now() - std::time::Duration::from_secs(secs);
        }
    }

    pub async fn maybe_flush(&self, pool: &SqlitePool) -> Result<(), OprfError> {
        let should_flush = {
            let mut last_flush = self
                .last_flush
                .lock()
                .map_err(|e| OprfError::Evaluation(e.to_string()))?;

            if last_flush.elapsed().as_secs() >= 3600 {
                *last_flush = Instant::now();
                true
            } else {
                false
            }
        };

        if should_flush {
            let count = self.counter.swap(0, Ordering::Relaxed);
            if count > 0 {
                let id = ulid::Ulid::new().to_string();
                let event = format!("blind_eval_hourly:count={}", count);
                sqlx::query("INSERT INTO oprf_audit (id, event) VALUES (?, ?)")
                    .bind(&id)
                    .bind(&event)
                    .execute(pool)
                    .await
                    .map_err(|e| OprfError::Evaluation(e.to_string()))?;
                tracing::info!("oprf blind evaluations flushed count={}", count);
            }
        }
        Ok(())
    }
}
