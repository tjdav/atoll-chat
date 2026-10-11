use crate::error::ApiError;
use serde_json::Value;

pub const DECLARATIONS_MAX_BYTES: usize = 256 * 1024; // 256 KiB

pub fn validate_declarations_top_level(value: &Value) -> Result<(), ApiError> {
    let json_str = serde_json::to_string(value).map_err(|e| ApiError::BadRequest(e.to_string()))?;
    if json_str.len() > DECLARATIONS_MAX_BYTES {
        return Err(ApiError::InternalCustom(
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            "declarations_too_large".into(),
        ));
    }

    let obj = match value.as_object() {
        Some(o) => o,
        None => return Err(ApiError::BadRequest("invalid_declarations".into())),
    };

    let schema_version = match obj.get("schema_version") {
        Some(v) => match v.as_i64() {
            Some(ver) => ver,
            None => return Err(ApiError::BadRequest("invalid_declarations".into())),
        },
        None => return Err(ApiError::BadRequest("invalid_declarations".into())),
    };

    if schema_version != 1 {
        return Err(ApiError::BadRequest("unsupported_schema_version".into()));
    }

    match obj.get("commands") {
        Some(v) if v.is_array() => {}
        _ => return Err(ApiError::BadRequest("invalid_declarations".into())),
    }

    match obj.get("settings") {
        Some(v) if v.is_array() => {}
        _ => return Err(ApiError::BadRequest("invalid_declarations".into())),
    }

    Ok(())
}
