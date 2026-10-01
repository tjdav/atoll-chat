pub mod envelope;
pub mod query;
pub mod seq;

pub use envelope::{publish_user_event, UserEventEnvelope};
pub use query::{
    execute_sync, DeviceStateRow, PreferenceRow, ReadStateRow, StarredItemRow, SyncQuery,
    SyncResponse,
};
pub use seq::allocate_user_seq;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid cursor: {0}")]
    InvalidCursor(String),
    #[error("serialization error: {0}")]
    Serialization(String),
}
