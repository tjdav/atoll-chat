use crate::error::ApiError;
use axum::http::StatusCode;
use serde_json::Value;

pub const MAX_DECLARATIONS_BYTES: usize = 256 * 1024; // 256 KiB

pub fn validate_declarations_top_level(val: &Value, raw_bytes_len: usize) -> Result<(), ApiError> {
    if raw_bytes_len > MAX_DECLARATIONS_BYTES {
        return Err(ApiError::InternalCustom(
            StatusCode::PAYLOAD_TOO_LARGE,
            "declarations_too_large".into(),
        ));
    }

    let obj = match val.as_object() {
        Some(o) => o,
        None => return Err(ApiError::BadRequest("invalid_declarations".into())),
    };

    let schema_version = match obj.get("schema_version").and_then(|v| v.as_i64()) {
        Some(ver) => ver,
        None => return Err(ApiError::BadRequest("invalid_declarations".into())),
    };

    if schema_version != 1 {
        return Err(ApiError::BadRequest("unsupported_schema_version".into()));
    }

    let commands = match obj.get("commands") {
        Some(c) => c,
        None => return Err(ApiError::BadRequest("invalid_declarations".into())),
    };
    if !commands.is_array() {
        return Err(ApiError::BadRequest("invalid_declarations".into()));
    }

    let settings = match obj.get("settings") {
        Some(s) => s,
        None => return Err(ApiError::BadRequest("invalid_declarations".into())),
    };
    if !settings.is_array() {
        return Err(ApiError::BadRequest("invalid_declarations".into()));
    }

    Ok(())
}
