use opaque_ke::{CipherSuite, Ristretto255, ServerSetup, TripleDh};
use rand::rngs::OsRng;
use sha2::Sha512;
use sqlx::SqlitePool;
use std::fs;
use std::path::{Path, PathBuf};
use tracing::info;

use crate::config::Config;

/// The OPAQUE cipher suite for this project.
/// Uses ristretto255 for the OPRF and key exchange groups,
/// SHA-512 as the hash, and Argon2 as the key stretching function.
pub struct DefaultCipherSuite;

impl CipherSuite for DefaultCipherSuite {
    type OprfCs = Ristretto255;
    type KeyExchange = TripleDh<Ristretto255, Sha512>;
    type Ksf = opaque_ke::argon2::Argon2<'static>;
}

#[derive(thiserror::Error, Debug)]
pub enum OpaqueError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Deserialization error: {0}")]
    Deserialization(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

pub struct OpaqueServer {
    pub setup: ServerSetup<DefaultCipherSuite>,
}

impl OpaqueServer {
    /// Load the OPRF key from disk, or generate one on first run.
    pub fn load_or_generate(path: &Path) -> Result<Self, OpaqueError> {
        if path.exists() {
            let bytes = fs::read(path)?;
            let setup = ServerSetup::<DefaultCipherSuite>::deserialize(&bytes)
                .map_err(|e| OpaqueError::Deserialization(e.to_string()))?;
            info!("opaque: loaded OPRF key from {}", path.display());
            Ok(Self { setup })
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let setup = ServerSetup::<DefaultCipherSuite>::new(&mut OsRng);
            let bytes = setup.serialize();
            fs::write(path, bytes)?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let permissions = fs::Permissions::from_mode(0o600);
                fs::set_permissions(path, permissions)?;
            }

            info!("opaque: generated new OPRF key at {}", path.display());
            Ok(Self { setup })
        }
    }
}

pub struct RotationResult {
    pub backup_path: PathBuf,
    pub users_affected: u64,
}

pub async fn rotate_oprf_key(
    pool: &SqlitePool,
    config: &Config,
    actor_id: Option<&str>,
) -> Result<RotationResult, OpaqueError> {
    let key_path = Path::new(&config.opaque_oprf_key_path);
    let timestamp = chrono::Utc::now().timestamp();
    let backup_path = PathBuf::from(format!("{}.bak.{}", config.opaque_oprf_key_path, timestamp));

    if key_path.exists() {
        fs::copy(key_path, &backup_path)?;
    }

    let res = sqlx::query("UPDATE users SET requires_reregistration = 1")
        .execute(pool)
        .await?;
    let users_affected = res.rows_affected();

    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let setup = ServerSetup::<DefaultCipherSuite>::new(&mut OsRng);
    let bytes = setup.serialize();
    fs::write(key_path, bytes)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(key_path, permissions)?;
    }

    let _ = crate::audit::log(
        pool,
        actor_id,
        crate::audit::action::OPRF_ROTATE,
        None,
        None,
        Some(serde_json::json!({
            "backup_path": backup_path.to_string_lossy(),
            "users_affected": users_affected
        })),
    )
    .await;

    Ok(RotationResult {
        backup_path,
        users_affected,
    })
}
