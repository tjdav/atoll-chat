pub mod device_names;
pub mod envelope;
pub mod preferences;
pub mod query;
pub mod read_state;
pub mod seq;
pub mod starred;

pub use crate::starred::StarredItemRow;
pub use device_names::DeviceStateRow;
pub use envelope::{publish_user_event, UserEventEnvelope};
pub use preferences::PreferenceRow;
pub use query::{execute_sync, BotSettingSyncRow, SyncQuery, SyncResponse};
pub use read_state::ReadStateRow;
pub use seq::allocate_user_seq;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid cursor: {0}")]
    InvalidCursor(String),
    #[error("serialization error: {0}")]
    Serialization(String),
    #[error("read state error: {0}")]
    ReadState(#[from] read_state::ReadStateError),
    #[error("preferences error: {0}")]
    Preferences(#[from] preferences::PreferencesError),
}
