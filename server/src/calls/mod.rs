use crate::error::ApiError;
use std::fmt;

#[derive(Debug)]
pub enum CallError {
    CallingDisabled,
    RoomNotFound,
    CallIdConflict,
    Database(sqlx::Error),
}

impl fmt::Display for CallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CallError::CallingDisabled => write!(f, "Calling is disabled on this server"),
            CallError::RoomNotFound => write!(f, "Room not found or user is not a member"),
            CallError::CallIdConflict => write!(f, "Call ID is already associated with another room"),
            CallError::Database(e) => write!(f, "Database error: {}", e),
        }
    }
}

impl std::error::Error for CallError {}

impl From<sqlx::Error> for CallError {
    fn from(err: sqlx::Error) -> Self {
        CallError::Database(err)
    }
}

impl From<CallError> for ApiError {
    fn from(err: CallError) -> Self {
        match err {
            CallError::CallingDisabled => ApiError::NotImplemented("calling_disabled".to_string()),
            CallError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
            CallError::CallIdConflict => ApiError::Conflict("call_id_conflict".to_string()),
            CallError::Database(e) => ApiError::Internal(e.into()),
        }
    }
}

pub mod signal;

pub use signal::send_signal;
