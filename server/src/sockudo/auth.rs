use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

pub fn compute_channel_auth(
    app_key: &str,
    app_secret: &str,
    socket_id: &str,
    channel: &str,
) -> String {
    let string_to_sign = format!("{}:{}", socket_id, channel);
    let mut mac =
        HmacSha256::new_from_slice(app_secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(string_to_sign.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());
    format!("{}:{}", app_key, signature)
}
