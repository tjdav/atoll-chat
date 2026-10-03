use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT};
use reqwest::redirect::Policy;
use reqwest::Client;
use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;
use tokio::net::lookup_host;
use url::Url;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SsrfError {
    #[error("url_blocked")]
    UrlBlocked,
    #[error("url_too_long")]
    UrlTooLong,
    #[error("fetch_failed")]
    FetchFailed,
    #[error("upstream_response_too_large")]
    UpstreamResponseTooLarge,
}

pub fn is_ipv4_blocked(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    // Loopback: 127.0.0.0/8
    if octets[0] == 127 {
        return true;
    }
    // Private: 10.0.0.0/8
    if octets[0] == 10 {
        return true;
    }
    // Private: 172.16.0.0/12
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        return true;
    }
    // Private: 192.168.0.0/16
    if octets[0] == 192 && octets[1] == 168 {
        return true;
    }
    // Link-local: 169.254.0.0/16
    if octets[0] == 169 && octets[1] == 254 {
        return true;
    }
    // Multicast: 224.0.0.0/4
    if (224..=239).contains(&octets[0]) {
        return true;
    }
    // Reserved / 0.0.0.0/8
    if octets[0] == 0 {
        return true;
    }
    // Reserved / 240.0.0.0/4
    if octets[0] >= 240 {
        return true;
    }
    // CGNAT: 100.64.0.0/10
    if octets[0] == 100 && (64..=127).contains(&octets[1]) {
        return true;
    }
    // TEST-NET-1: 192.0.2.0/24
    if octets[0] == 192 && octets[1] == 0 && octets[2] == 2 {
        return true;
    }
    // Inter-network: 198.18.0.0/15
    if octets[0] == 198 && (18..=19).contains(&octets[1]) {
        return true;
    }
    // TEST-NET-2: 198.51.100.0/24
    if octets[0] == 198 && octets[1] == 51 && octets[2] == 100 {
        return true;
    }
    // TEST-NET-3: 203.0.113.0/24
    if octets[0] == 203 && octets[1] == 0 && octets[2] == 113 {
        return true;
    }
    // AWS metadata
    if ip == Ipv4Addr::new(169, 254, 169, 254) {
        return true;
    }

    false
}

pub fn is_ipv6_blocked(ip: Ipv6Addr) -> bool {
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return is_ipv4_blocked(ipv4);
    }
    let octets = ip.octets();
    if ip.is_loopback() || ip == Ipv6Addr::LOCALHOST {
        return true;
    }
    if ip.is_unspecified() || ip == Ipv6Addr::UNSPECIFIED {
        return true;
    }
    // fc00::/7
    if (octets[0] & 0xfe) == 0xfc {
        return true;
    }
    // fe80::/10
    if octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80 {
        return true;
    }
    // ff00::/8
    if octets[0] == 0xff {
        return true;
    }
    // AWS metadata IPv6
    if let Ok(metadata_v6) = "fd00:ec2::254".parse::<Ipv6Addr>() {
        if ip == metadata_v6 {
            return true;
        }
    }

    false
}

pub fn is_ip_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => is_ipv4_blocked(ipv4),
        IpAddr::V6(ipv6) => is_ipv6_blocked(ipv6),
    }
}

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

            // Resolve host to IP addresses
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

            // Allowed response headers
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

fn decompress_gzip(compressed: &[u8], max_bytes: u64) -> Result<Vec<u8>, SsrfError> {
    use flate2::read::GzDecoder;
    let mut decoder = GzDecoder::new(compressed);
    let mut decompressed = Vec::new();
    let mut buffer = [0u8; 8192];

    loop {
        let read_bytes = decoder
            .read(&mut buffer)
            .map_err(|_| SsrfError::FetchFailed)?;
        if read_bytes == 0 {
            break;
        }
        if (decompressed.len() + read_bytes) as u64 > max_bytes {
            return Err(SsrfError::UpstreamResponseTooLarge);
        }
        decompressed.extend_from_slice(&buffer[..read_bytes]);
    }

    Ok(decompressed)
}

fn decompress_deflate(compressed: &[u8], max_bytes: u64) -> Result<Vec<u8>, SsrfError> {
    use flate2::read::ZlibDecoder;
    let mut decoder = ZlibDecoder::new(compressed);
    let mut decompressed = Vec::new();
    let mut buffer = [0u8; 8192];

    loop {
        let read_bytes = decoder
            .read(&mut buffer)
            .map_err(|_| SsrfError::FetchFailed)?;
        if read_bytes == 0 {
            break;
        }
        if (decompressed.len() + read_bytes) as u64 > max_bytes {
            return Err(SsrfError::UpstreamResponseTooLarge);
        }
        decompressed.extend_from_slice(&buffer[..read_bytes]);
    }

    Ok(decompressed)
}
