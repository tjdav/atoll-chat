use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const REQUEST_HEADER_ALLOWLIST: &[&str] = &[
    "accept",
    "accept-language",
    "accept-encoding",
    "cache-control",
    "if-none-match",
    "if-modified-since",
    "if-range",
    "range",
];

pub const RESPONSE_HEADER_ALLOWLIST: &[&str] = &[
    "content-type",
    "content-length",
    "etag",
    "last-modified",
    "cache-control",
    "expires",
    "date",
    "vary",
    "location",
    "retry-after",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtensionRequestPlaintext {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub body: Option<String>,
    pub extension_id: String,
    pub request_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtensionResponsePlaintext {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub request_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtensionErrorPlaintext {
    pub error: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ValidationError {
    UrlBlocked,
    UrlTooLong,
    MethodNotAllowed,
    HeaderNotAllowed,
    BodyTooLarge,
    InvalidRequest,
}

pub fn validate_request(
    req: &ExtensionRequestPlaintext,
    app_env: &str,
) -> Result<(), ValidationError> {
    let is_https = req.url.starts_with("https://");
    let is_http_dev = app_env != "production" && req.url.starts_with("http://");
    if !is_https && !is_http_dev {
        return Err(ValidationError::UrlBlocked);
    }

    if req.url.len() > 2048 {
        return Err(ValidationError::UrlTooLong);
    }

    let method_upper = req.method.to_uppercase();
    if method_upper != "GET" && method_upper != "POST" && method_upper != "HEAD" {
        return Err(ValidationError::MethodNotAllowed);
    }

    if let Some(ref headers) = req.headers {
        for name in headers.keys() {
            let name_lower = name.to_lowercase();
            if name_lower == "authorization" || name_lower == "cookie" {
                return Err(ValidationError::HeaderNotAllowed);
            }
            if !REQUEST_HEADER_ALLOWLIST.contains(&name_lower.as_str()) {
                return Err(ValidationError::HeaderNotAllowed);
            }
        }
    }

    if method_upper == "POST" {
        if let Some(ref body_str) = req.body {
            if body_str.len() > 262_144 {
                return Err(ValidationError::BodyTooLarge);
            }
        }
    } else if req.body.is_some() {
        return Err(ValidationError::InvalidRequest);
    }

    if req.extension_id.is_empty() || req.extension_id.len() > 128 {
        return Err(ValidationError::InvalidRequest);
    }

    if req.request_id.is_empty() || req.request_id.len() > 128 {
        return Err(ValidationError::InvalidRequest);
    }

    Ok(())
}
