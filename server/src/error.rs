use crate::config_ops::ConfigOpsError;
use crate::devices::DeviceError;
use crate::invites::InviteError;
use crate::key_packages::KeyPackageError;
use crate::limits::LimitsError;
use crate::rate_limit::RateLimitError;
use crate::room_invites::RoomInviteError;
use crate::room_messages::RoomMessageError;
use crate::rooms::{RoomError, RoomMetadataError};
use crate::session::SessionError;
use crate::sync::device_names::DeviceNameSyncError;
use crate::sync::preferences::PreferencesError;
use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde_json::json;
use tracing::error;

#[allow(dead_code)]
pub enum ApiError {
    NotFound(String),
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    Conflict(String),
    ConflictWithDetails(String, serde_json::Value),
    Gone(String),
    NotImplemented(String),
    InternalWithDetails(StatusCode, String, serde_json::Value),
    CustomShape(StatusCode, serde_json::Value),
    TooManyRequests {
        message: String,
        reset_at: DateTime<Utc>,
    },
    InternalCustom(StatusCode, String),
    Internal(anyhow::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::TooManyRequests { message, reset_at } => {
                let now = Utc::now();
                let retry_after = (reset_at - now).num_seconds().max(1);
                let body = Json(json!({
                    "error": "rate_limited",
                    "message": message,
                    "details": {
                        "reset_at": reset_at.to_rfc3339()
                    }
                }));
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(header::RETRY_AFTER, retry_after.to_string())],
                    body,
                )
                    .into_response()
            }
            _ => {
                let (status, err_msg) = match self {
                    ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
                    ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
                    ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
                    ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg),
                    ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
                    ApiError::ConflictWithDetails(msg, details) => {
                        let body = Json(json!({
                            "error": msg,
                            "details": details,
                        }));
                        return (StatusCode::CONFLICT, body).into_response();
                    }
                    ApiError::Gone(msg) => (StatusCode::GONE, msg),
                    ApiError::NotImplemented(msg) => (StatusCode::NOT_IMPLEMENTED, msg),
                    ApiError::InternalWithDetails(status, msg, details) => {
                        let body = Json(json!({
                            "error": msg,
                            "details": details,
                        }));
                        return (status, body).into_response();
                    }
                    ApiError::CustomShape(status, body) => {
                        return (status, Json(body)).into_response();
                    }
                    ApiError::InternalCustom(status, msg) => (status, msg),
                    ApiError::Internal(err) => {
                        error!("Internal server error: {:#}", err);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "internal server error".to_string(),
                        )
                    }
                    ApiError::TooManyRequests { .. } => unreachable!(),
                };

                let body = Json(json!({
                    "error": err_msg,
                }));

                (status, body).into_response()
            }
        }
    }
}

impl From<crate::sessions::SignalError> for ApiError {
    fn from(err: crate::sessions::SignalError) -> Self {
        use crate::sessions::SignalError;
        match err {
            SignalError::SessionsDisabled => {
                ApiError::NotImplemented("sessions_disabled".to_string())
            }
            SignalError::SessionNotFound => ApiError::NotFound("session_not_found".to_string()),
            SignalError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
            SignalError::InvalidClientId => ApiError::BadRequest("invalid_client_id".to_string()),
            SignalError::InvalidSignalType => {
                ApiError::BadRequest("invalid_signal_type".to_string())
            }
            SignalError::InvalidPayload => ApiError::BadRequest("invalid_payload".to_string()),
            SignalError::NotAParticipant => ApiError::Forbidden("not_a_participant".to_string()),
            SignalError::TargetNotFound => ApiError::NotFound("target_not_found".to_string()),
            SignalError::Device(e) => ApiError::from(e),
            SignalError::Database(e) => ApiError::from(e),
        }
    }
}

// Implement From<DeviceNameSyncError> for ApiError
impl From<DeviceNameSyncError> for ApiError {
    fn from(err: DeviceNameSyncError) -> Self {
        match err {
            DeviceNameSyncError::Database(e) => ApiError::Internal(e.into()),
            DeviceNameSyncError::DeviceNotOwned => {
                ApiError::NotFound("device_not_found".to_string())
            }
            DeviceNameSyncError::InvalidCiphertext(_) => {
                ApiError::BadRequest("invalid_encrypted_device_name".to_string())
            }
        }
    }
}

// Implement From<PreferencesError> for ApiError
impl From<PreferencesError> for ApiError {
    fn from(err: PreferencesError) -> Self {
        match err {
            PreferencesError::Database(e) => ApiError::Internal(e.into()),
            PreferencesError::InvalidKey(_) => ApiError::BadRequest("invalid_key".to_string()),
            PreferencesError::ReservedKey(k) => ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "reserved_key".to_string(),
                serde_json::json!({ "key": k }),
            ),
            PreferencesError::ValueTooLarge(limit, size) => ApiError::InternalWithDetails(
                StatusCode::PAYLOAD_TOO_LARGE,
                "value_too_large".to_string(),
                serde_json::json!({ "limit": limit, "size": size }),
            ),
            PreferencesError::Serialization(msg) => ApiError::BadRequest(msg),
        }
    }
}

// Implement From<RoomMessageError> for ApiError
impl From<RoomMessageError> for ApiError {
    fn from(err: RoomMessageError) -> Self {
        match err {
            RoomMessageError::Database(e) => ApiError::Internal(e.into()),
            RoomMessageError::RoomNotFound | RoomMessageError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomMessageError::MessageNotFound => {
                ApiError::NotFound("message_not_found".to_string())
            }
            RoomMessageError::AlreadyDeleted => ApiError::Conflict("already_deleted".to_string()),
            RoomMessageError::Forbidden => ApiError::Forbidden("forbidden".to_string()),
            RoomMessageError::MessageDeleted => ApiError::NotFound("message_deleted".to_string()),
            RoomMessageError::EditDeleted => ApiError::Conflict("message_deleted".to_string()),
            RoomMessageError::CannotEditEdit => ApiError::Conflict("cannot_edit_edit".to_string()),
            RoomMessageError::ContentTypeMismatch => {
                ApiError::BadRequest("content_type_mismatch".to_string())
            }
            RoomMessageError::NotSender => ApiError::Forbidden("forbidden".to_string()),
            RoomMessageError::NotEditable => ApiError::BadRequest("not_editable".to_string()),
            RoomMessageError::WindowExpired => {
                ApiError::Forbidden("edit_window_expired".to_string())
            }
            RoomMessageError::EpochMismatch { expected, received } => {
                ApiError::ConflictWithDetails(
                    "epoch_mismatch".to_string(),
                    serde_json::json!({
                        "expected": expected,
                        "received": received,
                    }),
                )
            }
            RoomMessageError::MissingTranscriptHash => {
                ApiError::BadRequest("missing_transcript_hash".to_string())
            }
            RoomMessageError::NoEpochEstablished => {
                ApiError::BadRequest("no_epoch_established".to_string())
            }
            RoomMessageError::ReplyToNotFound => {
                ApiError::BadRequest("reply_to_not_found".to_string())
            }
            RoomMessageError::ReplyToNotInRoom => {
                ApiError::BadRequest("reply_to_not_in_room".to_string())
            }
        }
    }
}

// Implement From<KeyPackageError> for ApiError
impl From<KeyPackageError> for ApiError {
    fn from(err: KeyPackageError) -> Self {
        match err {
            KeyPackageError::Database(e) => ApiError::Internal(e.into()),
            KeyPackageError::QuotaExceeded { .. } => {
                ApiError::Conflict("quota_exceeded".to_string())
            }
            KeyPackageError::NoPackagesAvailable => {
                ApiError::NotFound("no_packages_available".to_string())
            }
            KeyPackageError::UserNotFound => ApiError::NotFound("user_not_found".to_string()),
        }
    }
}

// Implement From<RoomInviteError> for ApiError
impl From<RoomInviteError> for ApiError {
    fn from(err: RoomInviteError) -> Self {
        match err {
            RoomInviteError::Database(e) => ApiError::Internal(e.into()),
            RoomInviteError::RoomNotFound | RoomInviteError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomInviteError::InviteNotFound => ApiError::NotFound("invite_not_found".to_string()),
            RoomInviteError::Revoked => ApiError::Gone("invite_revoked".to_string()),
            RoomInviteError::Expired => ApiError::Gone("invite_expired".to_string()),
            RoomInviteError::Exhausted => ApiError::Gone("invite_exhausted".to_string()),
            RoomInviteError::RoomFull => ApiError::Conflict("room_full".to_string()),
            RoomInviteError::InvalidMaxUses => ApiError::BadRequest("invalid_max_uses".to_string()),
            RoomInviteError::InvalidExpiry => ApiError::BadRequest("invalid_expiry".to_string()),
            RoomInviteError::CodeGenerationFailed => {
                ApiError::Internal(anyhow::anyhow!("failed to generate room invite code"))
            }
        }
    }
}

// Implement From<ConfigOpsError> for ApiError
impl From<ConfigOpsError> for ApiError {
    fn from(err: ConfigOpsError) -> Self {
        ApiError::Internal(err.into())
    }
}

// Implement From<LimitsError> for ApiError
impl From<LimitsError> for ApiError {
    fn from(err: LimitsError) -> Self {
        match err {
            LimitsError::Database(e) => ApiError::Internal(e.into()),
            LimitsError::ExceedsServerMax { .. } | LimitsError::BelowMinimum { .. } => {
                ApiError::BadRequest(err.to_string())
            }
        }
    }
}

// Implement From<RoomMetadataError> for ApiError
impl From<RoomMetadataError> for ApiError {
    fn from(err: RoomMetadataError) -> Self {
        match err {
            RoomMetadataError::TooLarge(limit, size) => ApiError::InternalWithDetails(
                StatusCode::PAYLOAD_TOO_LARGE,
                "metadata_too_large".to_string(),
                serde_json::json!({ "limit": limit, "size": size }),
            ),
            RoomMetadataError::InvalidEncoding => {
                ApiError::BadRequest("invalid_metadata".to_string())
            }
            RoomMetadataError::Database(e) => ApiError::Internal(e.into()),
            RoomMetadataError::RoomNotFound | RoomMetadataError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomMetadataError::Forbidden => ApiError::Forbidden("forbidden".to_string()),
        }
    }
}

// Implement From<RoomError> for ApiError
impl From<crate::sessions::OccupancyError> for ApiError {
    fn from(err: crate::sessions::OccupancyError) -> Self {
        use crate::sessions::OccupancyError;
        match err {
            OccupancyError::SessionsDisabled => {
                ApiError::NotImplemented("sessions_disabled".to_string())
            }
            OccupancyError::SessionNotFound => ApiError::NotFound("session_not_found".to_string()),
            OccupancyError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
            OccupancyError::Forbidden => ApiError::Forbidden("forbidden".to_string()),
            OccupancyError::InvalidClientId => {
                ApiError::BadRequest("invalid_client_id".to_string())
            }
            OccupancyError::SessionFull => ApiError::Conflict("session_full".to_string()),
            OccupancyError::NotAParticipant => ApiError::Forbidden("not_a_participant".to_string()),
            OccupancyError::Device(e) => ApiError::from(e),
            OccupancyError::Database(e) => ApiError::from(e),
        }
    }
}

impl From<RoomError> for ApiError {
    fn from(err: RoomError) -> Self {
        match err {
            RoomError::Database(e) => ApiError::Internal(e.into()),
            RoomError::RoomNotFound | RoomError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomError::Forbidden => ApiError::Forbidden("forbidden".to_string()),
            RoomError::RoomFull => ApiError::Conflict("room_full".to_string()),
            RoomError::UserNotFound => ApiError::NotFound("user_not_found".to_string()),
            RoomError::AlreadyMember => ApiError::Conflict("already_member".to_string()),
            RoomError::RoomLimitReached => ApiError::Conflict("room_limit_reached".to_string()),
            RoomError::InvalidRetention => ApiError::BadRequest("invalid_retention".to_string()),
            RoomError::InvalidFileSize => ApiError::BadRequest("invalid_file_size".to_string()),
            RoomError::TargetNotAMember => ApiError::NotFound("member_not_found".to_string()),
            RoomError::CannotKickOwner => ApiError::BadRequest("cannot_kick_owner".to_string()),
            RoomError::CannotKickSelf => ApiError::BadRequest("cannot_kick_self".to_string()),
            RoomError::ModerationDisabled => ApiError::Conflict("moderation_disabled".to_string()),
            RoomError::AlreadyModerator => ApiError::Conflict("already_moderator".to_string()),
            RoomError::NotAModerator => ApiError::Conflict("not_a_moderator".to_string()),
            RoomError::CannotModifyOwner => ApiError::BadRequest("cannot_modify_owner".to_string()),
            RoomError::AlreadyOwner => ApiError::Conflict("already_owner".to_string()),
            RoomError::CannotTransferToSelf => {
                ApiError::BadRequest("cannot_transfer_to_self".to_string())
            }
            RoomError::TargetHasNoDevice => {
                ApiError::BadRequest("target_has_no_device".to_string())
            }
            RoomError::RemoveNotFound => ApiError::NotFound("remove_not_found".to_string()),
            RoomError::PendingAddNotFound => {
                ApiError::NotFound("pending_add_not_found".to_string())
            }
            RoomError::AlreadyConsumed => ApiError::Conflict("already_consumed".to_string()),
        }
    }
}

// Implement From<anyhow::Error> for ApiError
impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(err)
    }
}

// Implement From<sqlx::Error> for ApiError
impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::Internal(err.into())
    }
}

// Implement From<SessionError> for ApiError
impl From<SessionError> for ApiError {
    fn from(err: SessionError) -> Self {
        match err {
            SessionError::Database(e) => ApiError::Internal(e.into()),
            SessionError::TokenGeneration(msg) => ApiError::Internal(anyhow::anyhow!(msg)),
        }
    }
}

// Implement From<DeviceError> for ApiError
impl From<DeviceError> for ApiError {
    fn from(err: DeviceError) -> Self {
        match err {
            DeviceError::Database(e) => ApiError::Internal(e.into()),
            DeviceError::Push(e) => ApiError::Internal(anyhow::anyhow!(e)),
            DeviceError::DeviceLimitExceeded { .. } => {
                ApiError::BadRequest("device_limit_exceeded".to_string())
            }
            DeviceError::NotFound => ApiError::NotFound("device_not_found".to_string()),
        }
    }
}

// Implement From<RateLimitError> for ApiError
impl From<RateLimitError> for ApiError {
    fn from(err: RateLimitError) -> Self {
        match err {
            RateLimitError::Database(e) => ApiError::Internal(e.into()),
            RateLimitError::InvalidKey(msg) => ApiError::BadRequest(msg),
        }
    }
}

// Implement From<InviteError> for ApiError
impl From<InviteError> for ApiError {
    fn from(err: InviteError) -> Self {
        match err {
            InviteError::Database(e) => ApiError::Internal(e.into()),
            InviteError::NotFound => ApiError::NotFound("invite_not_found".to_string()),
            InviteError::Revoked => ApiError::Forbidden("invite_revoked".to_string()),
            InviteError::Expired => ApiError::Forbidden("invite_expired".to_string()),
            InviteError::Exhausted => ApiError::Forbidden("invite_exhausted".to_string()),
            InviteError::CodeGenerationFailed => {
                ApiError::Internal(anyhow::anyhow!("failed to generate invite code"))
            }
        }
    }
}
