use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use reqwest::redirect::Policy;
use reqwest::Client;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::lookup_host;
use url::Url;

pub use crate::proxy_common::ssrf::{
    decompress_deflate, decompress_gzip, is_ip_blocked, is_ipv4_blocked, is_ipv6_blocked, SsrfError,
};

pub struct FetchResult {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body_bytes: Vec<u8>,
}

pub struct FetchOptions<'a> {
    pub app_env: &'a str,
    pub timeout_seconds: u64,
    pub max_bytes: u64,
    pub allow_local_for_test: bool,
}

pub async fn fetch_url_ssrf_guarded(
    raw_url: &str,
    opts: FetchOptions<'_>,
) -> Result<FetchResult, SsrfError> {
    if raw_url.len() > 2048 {
        return Err(SsrfError::UrlTooLong);
    }

    let total_timeout = Duration::from_secs(opts.timeout_seconds.saturating_mul(2));

    tokio::time::timeout(total_timeout, async move {
        let mut current_url = Url::parse(raw_url).map_err(|_| SsrfError::UrlBlocked)?;
        let mut redirect_count = 0;

        loop {
            let scheme = current_url.scheme();
            if scheme != "https" && (opts.app_env == "production" || scheme != "http") {
                return Err(SsrfError::UrlBlocked);
            }

            let host_str = current_url.host_str().ok_or(SsrfError::UrlBlocked)?;
            let port = current_url
                .port_or_known_default()
                .ok_or(SsrfError::UrlBlocked)?;

            let lookup_target = format!("{}:{}", host_str, port);
            let addrs = lookup_host(&lookup_target)
                .await
                .map_err(|_| SsrfError::FetchFailed)?;

            let resolved_addrs: Vec<SocketAddr> = addrs.collect();
            if resolved_addrs.is_empty() {
                return Err(SsrfError::FetchFailed);
            }

            if !opts.allow_local_for_test {
                for addr in &resolved_addrs {
                    if is_ip_blocked(addr.ip()) {
                        return Err(SsrfError::UrlBlocked);
                    }
                }
            }

            let target_addr = resolved_addrs[0];

            let client = Client::builder()
                .resolve(host_str, target_addr)
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(opts.timeout_seconds))
                .timeout(Duration::from_secs(opts.timeout_seconds))
                .build()
                .map_err(|_| SsrfError::FetchFailed)?;

            let mut headers = HeaderMap::new();
            headers.insert(USER_AGENT, HeaderValue::from_static("Atoll/LinkPreview"));
            headers.insert(ACCEPT, HeaderValue::from_static("*/*"));

            let res = client
                .get(current_url.as_str())
                .headers(headers)
                .send()
                .await
                .map_err(|_| SsrfError::FetchFailed)?;

            let status = res.status();
            if status.is_redirection() {
                redirect_count += 1;
                if redirect_count > 5 {
                    return Err(SsrfError::FetchFailed);
                }

                let location = res
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|h| h.to_str().ok())
                    .ok_or(SsrfError::FetchFailed)?;

                current_url = current_url
                    .join(location)
                    .map_err(|_| SsrfError::UrlBlocked)?;
                continue;
            }

            let mut forwarded_headers = HashMap::new();
            let allowlist = [
                "content-type",
                "content-length",
                "etag",
                "last-modified",
                "cache-control",
                "expires",
            ];

            for (k, v) in res.headers() {
                let name_lower = k.as_str().to_lowercase();
                if allowlist.contains(&name_lower.as_str()) {
                    if let Ok(val_str) = v.to_str() {
                        forwarded_headers.insert(name_lower, val_str.to_string());
                    }
                }
            }

            let content_encoding = res
                .headers()
                .get(reqwest::header::CONTENT_ENCODING)
                .and_then(|h| h.to_str().ok())
                .unwrap_or("")
                .to_lowercase();

            let raw_body_bytes = res.bytes().await.map_err(|_| SsrfError::FetchFailed)?;

            let decompressed_bytes = if content_encoding.contains("gzip") {
                decompress_gzip(&raw_body_bytes, opts.max_bytes)?
            } else if content_encoding.contains("deflate") {
                decompress_deflate(&raw_body_bytes, opts.max_bytes)?
            } else {
                if raw_body_bytes.len() as u64 > opts.max_bytes {
                    return Err(SsrfError::UpstreamResponseTooLarge);
                }
                raw_body_bytes.to_vec()
            };

            return Ok(FetchResult {
                status: status.as_u16(),
                headers: forwarded_headers,
                body_bytes: decompressed_bytes,
            });
        }
    })
    .await
    .map_err(|_| SsrfError::FetchFailed)?
}
