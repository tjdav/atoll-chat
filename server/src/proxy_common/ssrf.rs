use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SsrfError {
    #[error("url_blocked")]
    UrlBlocked,
    #[error("domain_blocked")]
    DomainBlocked,
    #[error("url_too_long")]
    UrlTooLong,
    #[error("fetch_failed")]
    FetchFailed,
    #[error("upstream_response_too_large")]
    UpstreamResponseTooLarge,
}

pub fn is_ipv4_blocked(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    if octets[0] == 127 {
        return true;
    }
    if octets[0] == 10 {
        return true;
    }
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        return true;
    }
    if octets[0] == 192 && octets[1] == 168 {
        return true;
    }
    if octets[0] == 169 && octets[1] == 254 {
        return true;
    }
    if (224..=239).contains(&octets[0]) {
        return true;
    }
    if octets[0] == 0 {
        return true;
    }
    if octets[0] >= 240 {
        return true;
    }
    if octets[0] == 100 && (64..=127).contains(&octets[1]) {
        return true;
    }
    if octets[0] == 192 && octets[1] == 0 && octets[2] == 2 {
        return true;
    }
    if octets[0] == 198 && (18..=19).contains(&octets[1]) {
        return true;
    }
    if octets[0] == 198 && octets[1] == 51 && octets[2] == 100 {
        return true;
    }
    if octets[0] == 203 && octets[1] == 0 && octets[2] == 113 {
        return true;
    }
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
    if (octets[0] & 0xfe) == 0xfc {
        return true;
    }
    if octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80 {
        return true;
    }
    if octets[0] == 0xff {
        return true;
    }
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

pub fn decompress_gzip(compressed: &[u8], max_bytes: u64) -> Result<Vec<u8>, SsrfError> {
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

pub fn decompress_deflate(compressed: &[u8], max_bytes: u64) -> Result<Vec<u8>, SsrfError> {
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
