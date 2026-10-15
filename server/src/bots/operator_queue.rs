use serde_json::Value;

/// Derives a short text preview from an opaque JSON payload per proposal §9.
/// Priority rules:
/// 1. If payload is a string, use it.
/// 2. If payload is an object with a `preview` string field, use it.
/// 3. If payload is an object with a `message` string field, use it.
/// 4. If payload is an object with a `question` string field, use it.
/// 5. Otherwise, return "[request]".
///
/// Truncates string results longer than 120 characters with an ellipsis ("...").
pub fn derive_payload_preview(payload: &Value) -> String {
    let raw = if let Some(s) = payload.as_str() {
        s
    } else if let Some(obj) = payload.as_object() {
        obj.get("preview")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("message").and_then(|v| v.as_str()))
            .or_else(|| obj.get("question").and_then(|v| v.as_str()))
            .unwrap_or("[request]")
    } else {
        "[request]"
    };

    if raw.chars().count() > 120 {
        let mut truncated: String = raw.chars().take(120).collect();
        truncated.push_str("...");
        truncated
    } else {
        raw.to_string()
    }
}
