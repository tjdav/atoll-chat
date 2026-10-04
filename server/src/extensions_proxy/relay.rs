use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, USER_AGENT};
use reqwest::redirect::Policy;
use reqwest::Client;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::str::FromStr;
use std::time::Duration;
use tokio::net::lookup_host;
use url::Url;

use crate::extensions_proxy::blocklist::DomainBlocklist;
use crate::extensions_proxy::validate::{ExtensionRequestPlaintext, RESPONSE_HEADER_ALLOWLIST};
use crate::proxy_common::ssrf::{decompress_deflate, decompress_gzip, is_ip_blocked, SsrfError};

pub struct OutboundFetchOptions<'a> {
    pub app_env: &'a str,
    pub connect_timeout_seconds: u64,
    pub read_timeout_seconds: u64,
    pub max_response_bytes: u64,
    pub user_agent: &'a str,
    pub allow_local_for_test: bool,
    pub blocklist: Option<&'a DomainBlocklist>,
}

pub struct OutboundFetchResult {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body_bytes: Vec<u8>,
}

pub async fn execute_outbound_fetch(
    req: &ExtensionRequestPlaintext,
    opts: OutboundFetchOptions<'_>,
) -> Result<OutboundFetchResult, SsrfError> {
    let connect_timeout = Duration::from_secs(opts.connect_timeout_seconds);
    let read_timeout = Duration::from_secs(opts.read_timeout_seconds);
    let total_timeout = Duration::from_secs(opts.read_timeout_seconds.saturating_mul(2));

    tokio::time::timeout(total_timeout, async move {
        let mut current_url = Url::parse(&req.url).map_err(|_| SsrfError::UrlBlocked)?;
        let method_upper = req.method.to_uppercase();
        let mut redirect_count = 0;

        loop {
            let scheme = current_url.scheme();
            if scheme != "https" && (opts.app_env == "production" || scheme != "http") {
                return Err(SsrfError::UrlBlocked);
            }

            let host_str = current_url.host_str().ok_or(SsrfError::UrlBlocked)?;

            if let Ok(ip) = host_str.parse::<std::net::IpAddr>() {
                if !opts.allow_local_for_test && is_ip_blocked(ip) {
                    return Err(SsrfError::UrlBlocked);
                }
            }

            if let Some(blocklist) = opts.blocklist {
                if blocklist.is_blocked(host_str) {
                    return Err(SsrfError::DomainBlocked);
                }
            }

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
                .connect_timeout(connect_timeout)
                .timeout(read_timeout)
                .build()
                .map_err(|_| SsrfError::FetchFailed)?;

            let mut headers = HeaderMap::new();
            if let Ok(ua_val) = HeaderValue::from_str(opts.user_agent) {
                headers.insert(USER_AGENT, ua_val);
            }
            headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate"));

            if let Some(ref req_headers) = req.headers {
                for (k, v) in req_headers {
                    let k_lower = k.to_lowercase();
                    if k_lower == "user-agent" {
                        continue;
                    }
                    if let (Ok(h_name), Ok(h_val)) =
                        (HeaderName::from_str(&k_lower), HeaderValue::from_str(v))
                    {
                        headers.insert(h_name, h_val);
                    }
                }
            }

            let req_builder = match method_upper.as_str() {
                "GET" => client.get(current_url.as_str()),
                "HEAD" => client.head(current_url.as_str()),
                "POST" => {
                    let mut b = client.post(current_url.as_str());
                    if let Some(ref body_str) = req.body {
                        b = b.body(body_str.clone());
                    }
                    b
                }
                _ => return Err(SsrfError::FetchFailed),
            };

            let res = req_builder
                .headers(headers)
                .send()
                .await
                .map_err(|_| SsrfError::FetchFailed)?;

            let status = res.status();
            if status.is_redirection() {
                let status_u16 = status.as_u16();

                if method_upper == "POST" {
                    if status_u16 == 307 || status_u16 == 308 {
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
                    for (k, v) in res.headers() {
                        let name_lower = k.as_str().to_lowercase();
                        if RESPONSE_HEADER_ALLOWLIST.contains(&name_lower.as_str()) {
                            if let Ok(val_str) = v.to_str() {
                                forwarded_headers.insert(name_lower, val_str.to_string());
                            }
                        }
                    }

                    return Ok(OutboundFetchResult {
                        status: status_u16,
                        headers: forwarded_headers,
                        body_bytes: Vec::new(),
                    });
                } else {
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
            }

            let content_encoding = res
                .headers()
                .get(reqwest::header::CONTENT_ENCODING)
                .and_then(|h| h.to_str().ok())
                .unwrap_or("")
                .to_lowercase();

            let is_compressed =
                content_encoding.contains("gzip") || content_encoding.contains("deflate");

            let mut forwarded_headers = HashMap::new();
            for (k, v) in res.headers() {
                let name_lower = k.as_str().to_lowercase();
                if RESPONSE_HEADER_ALLOWLIST.contains(&name_lower.as_str()) {
                    if is_compressed
                        && (name_lower == "content-encoding" || name_lower == "content-length")
                    {
                        continue;
                    }
                    if let Ok(val_str) = v.to_str() {
                        forwarded_headers.insert(name_lower, val_str.to_string());
                    }
                }
            }

            let raw_body_bytes = res.bytes().await.map_err(|_| SsrfError::FetchFailed)?;

            let decompressed_bytes = if content_encoding.contains("gzip") {
                decompress_gzip(&raw_body_bytes, opts.max_response_bytes)?
            } else if content_encoding.contains("deflate") {
                decompress_deflate(&raw_body_bytes, opts.max_response_bytes)?
            } else {
                if raw_body_bytes.len() as u64 > opts.max_response_bytes {
                    return Err(SsrfError::UpstreamResponseTooLarge);
                }
                raw_body_bytes.to_vec()
            };

            return Ok(OutboundFetchResult {
                status: status.as_u16(),
                headers: forwarded_headers,
                body_bytes: if method_upper == "HEAD" {
                    Vec::new()
                } else {
                    decompressed_bytes
                },
            });
        }
    })
    .await
    .map_err(|_| SsrfError::FetchFailed)?
}
