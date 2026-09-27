use crate::config::Config;
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

pub async fn enforce_https(
    State(config): State<Arc<Config>>,
    req: Request,
    next: Next,
) -> Response {
    if config.app_env != "production" {
        return next.run(req).await;
    }

    let path = req.uri().path();
    if path == "/health" || path == "/ready" {
        return next.run(req).await;
    }

    let is_http = if config.trust_proxy {
        let xfp_header = HeaderName::from_static("x-forwarded-proto");
        if let Some(val) = req.headers().get(&xfp_header) {
            if let Ok(s) = val.to_str() {
                s.eq_ignore_ascii_case("http")
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    if is_http {
        let app_url = config
            .app_url
            .as_deref()
            .unwrap_or("")
            .trim_end_matches('/');
        let path_and_query = req
            .uri()
            .path_and_query()
            .map(|pq| pq.as_str())
            .unwrap_or("/");
        let location_url = format!("{}{}", app_url, path_and_query);

        let location_header = match HeaderValue::from_str(&location_url) {
            Ok(val) => val,
            Err(e) => {
                tracing::warn!("Failed to create Location header value: {}", e);
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::empty())
                    .unwrap_or_else(|_| Response::default());
            }
        };

        let redirect_resp = Response::builder()
            .status(StatusCode::MOVED_PERMANENTLY)
            .header(header::LOCATION, location_header)
            .body(Body::empty());

        return match redirect_resp {
            Ok(resp) => resp,
            Err(e) => {
                tracing::warn!("Failed to build 301 redirect response: {}", e);
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::empty())
                    .unwrap_or_else(|_| Response::default())
            }
        };
    }

    let mut response = next.run(req).await;

    if config.hsts_max_age > 0 {
        let hsts_val_str = if config.hsts_include_subdomains {
            format!("max-age={}; includeSubDomains", config.hsts_max_age)
        } else {
            format!("max-age={}", config.hsts_max_age)
        };

        match HeaderValue::from_str(&hsts_val_str) {
            Ok(val) => {
                response
                    .headers_mut()
                    .insert(HeaderName::from_static("strict-transport-security"), val);
            }
            Err(e) => {
                tracing::warn!(
                    "Failed to create Strict-Transport-Security header value: {}",
                    e
                );
            }
        }
    }

    response
}
