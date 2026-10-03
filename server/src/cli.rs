use clap::{Parser, Subcommand};
use std::path::PathBuf;

use crate::config::Config;
use crate::db;

#[derive(Parser, Debug)]
#[command(name = "server")]
#[command(about = "Encrypted Chat Server", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Run the HTTP server (default)
    Serve,

    /// Run pending database migrations and exit
    Migrate,

    /// Regenerate VAPID keys and revoke all push subscriptions
    RotateVapid,

    /// Regenerate ALTCHA HMAC secret
    RotateAltcha,

    /// Resample OPRF seed (destructive: invalidates user registrations)
    RotateOprf {
        #[arg(long, default_value_t = false)]
        confirm: bool,
    },

    /// Restore from a backup
    Restore {
        #[arg(long)]
        from: PathBuf,

        #[arg(long, default_value_t = false)]
        confirm: bool,
    },

    /// Migrate attachment storage backend
    StorageMigrate {
        #[arg(long)]
        from: String,

        #[arg(long)]
        to: String,

        #[arg(long, default_value = "100")]
        batch_size: usize,

        #[arg(long, default_value = "4")]
        concurrency: usize,

        #[arg(long)]
        delete_source: bool,

        #[arg(long)]
        dry_run: bool,
    },

    /// Key Transparency operator subcommands
    Kt {
        #[command(subcommand)]
        command: KtCommand,
    },

    /// Session Types operator subcommands
    SessionTypes {
        #[command(subcommand)]
        command: SessionTypesCommand,
    },
}

#[derive(Subcommand, Debug)]
pub enum SessionTypesCommand {
    /// Validate session types TOML configuration file
    Validate {
        /// Optional path to SESSION_TYPES.toml file
        #[arg(long)]
        path: Option<PathBuf>,
    },
}

#[derive(Subcommand, Debug)]
pub enum KtCommand {
    /// Compute key transparency Merkle tree root and create signed snapshot
    Snapshot,

    /// Verify key transparency Merkle tree and snapshot signature
    Verify {
        /// Starting leaf index for tree computation (performance hint)
        #[arg(long)]
        from: Option<i64>,
    },
}

pub async fn run_migrate() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let pool = db::init_pool(&config).await?;
    let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await?;
    println!("Migrations applied. Total tracked: {}", applied);
    Ok(())
}

pub async fn run_rotate_vapid() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let pool = db::init_pool(&config).await?;
    let res = crate::push::vapid::rotate_vapid_keys(&pool, None).await?;
    let prefix = if res.public_key.len() >= 16 {
        &res.public_key[..16]
    } else {
        &res.public_key
    };
    println!("VAPID keys rotated.");
    println!("Public key: {}...", prefix);
    println!("Subscriptions revoked: {}", res.subscriptions_revoked);
    println!("Clients must re-register for push notifications.");
    Ok(())
}

pub async fn run_rotate_altcha() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let pool = db::init_pool(&config).await?;
    crate::altcha::rotate_hmac_secret(&pool, None).await?;
    println!("ALTCHA HMAC secret rotated.");
    println!("In-flight challenges are now invalid.");
    Ok(())
}

pub async fn run_rotate_oprf(confirm: bool) -> Result<(), Box<dyn std::error::Error>> {
    if !confirm {
        eprintln!("ERROR: rotate-oprf invalidates all user registrations.");
        eprintln!("Every user will be unable to log in until they re-register.");
        eprintln!("Run with --confirm to proceed.");
        return Err("rotate-oprf requires --confirm".into());
    }

    let config = Config::from_env()?;
    let pool = db::init_pool(&config).await?;

    let outcome = crate::oprf::rotation::rotate_oprf_key(&pool, &config).await?;

    let _ = crate::audit::log(
        &pool,
        None, // CLI actor is anonymous
        crate::audit::action::OPRF_ROTATE,
        Some("server_setup"),
        None,
        Some(serde_json::json!({
            "users_flagged": outcome.users_flagged,
            "backup_path": outcome.backup_path.display().to_string(),
        })),
    )
    .await;

    println!("OPRF key rotated.");
    println!("Backup saved to: {}", outcome.backup_path.display());
    println!(
        "Users flagged for re-registration: {}",
        outcome.users_flagged
    );
    println!("The server must be restarted for the new key to take effect.");
    println!("All flagged users will be unable to log in until they re-register.");

    Ok(())
}

pub async fn run_storage_migrate(
    from: String,
    to: String,
    batch_size: usize,
    concurrency: usize,
    delete_source: bool,
    dry_run: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    if from == to {
        eprintln!(
            "ERROR: source and destination backends must differ (got from={}, to={})",
            from, to
        );
        return Err("source and destination backends must differ".into());
    }

    if from != "fs" && from != "s3" {
        eprintln!(
            "ERROR: invalid source storage backend '{}' (must be 'fs' or 's3')",
            from
        );
        return Err(format!("invalid source backend: {}", from).into());
    }

    if to != "fs" && to != "s3" {
        eprintln!(
            "ERROR: invalid destination storage backend '{}' (must be 'fs' or 's3')",
            to
        );
        return Err(format!("invalid destination backend: {}", to).into());
    }

    let config = Config::from_env()?;
    let pool = db::init_pool(&config).await?;

    println!("Storage migration: {} \u{2192} {}", from, to);
    println!("Batch size: {}", batch_size);
    println!("Concurrency: {}", concurrency);
    println!("Delete source: {}", delete_source);
    println!("Dry run: {}", dry_run);
    println!();
    println!("Starting migration...");
    println!();

    let options = crate::storage::MigrationOptions {
        from: from.clone(),
        to: to.clone(),
        batch_size,
        concurrency,
        delete_source,
        dry_run,
    };

    let report = crate::storage::migrate_storage(&pool, &config, options).await?;

    if dry_run {
        println!("Dry run complete. No changes made.");
        println!("Rows that would be migrated: {}", report.progress.migrated);
        let mb = report.progress.bytes_transferred as f64 / 1_048_576.0;
        println!(
            "Bytes that would be transferred: {} ({:.1} MB)",
            report.progress.bytes_transferred, mb
        );
        return Ok(());
    }

    let duration_s = (report.finished_at - report.started_at).num_milliseconds() as f64 / 1000.0;
    let mb = report.progress.bytes_transferred as f64 / 1_048_576.0;

    if report.progress.failed == 0 {
        println!("Migration complete.");
        println!();
        println!("Total rows: {}", report.progress.total);
        println!("Migrated:   {}", report.progress.migrated);
        println!("Failed:     {}", report.progress.failed);
        println!("Skipped:    {}", report.progress.skipped);
        println!(
            "Bytes:      {} ({:.1} MB)",
            report.progress.bytes_transferred, mb
        );
        println!("Duration:   {:.1}s", duration_s);
        println!();
        println!(
            "Update STORAGE_BACKEND={} in your environment and restart the server.",
            to
        );
        Ok(())
    } else {
        println!("Migration complete with failures.");
        println!();
        println!("Total rows: {}", report.progress.total);
        println!("Migrated:   {}", report.progress.migrated);
        println!("Failed:     {}", report.progress.failed);
        println!();
        println!("First {} failures:", report.failures.len());
        for failure in &report.failures {
            println!("  {} : {}", failure.attachment_id, failure.reason);
        }
        println!();
        println!("Rerun the command to retry failures.");
        Err(format!(
            "migration completed with {} failures",
            report.progress.failed
        )
        .into())
    }
}

pub async fn run_kt_snapshot() -> Result<(), Box<dyn std::error::Error>> {
    use crate::key_transparency;
    use crate::opaque::OpaqueServer;
    use crate::sockudo::{Publisher, SockudoConfig};
    use std::path::Path;

    let config = Config::from_env()?;
    if !config.key_transparency_enabled {
        eprintln!("ERROR: Key transparency is disabled (KEY_TRANSPARENCY_ENABLED=false)");
        return Err("key_transparency_disabled".into());
    }

    let pool = db::init_pool(&config).await?;
    let key_path = Path::new(&config.opaque_oprf_key_path);
    let opaque_server = OpaqueServer::load_or_generate(key_path)?;
    let sockudo_config = SockudoConfig::load_or_initialize(&pool, &config).await?;
    let publisher = Publisher::new(sockudo_config);

    let snapshot =
        key_transparency::create_snapshot(&pool, &opaque_server, &publisher, &config, None).await?;

    let json = serde_json::to_string_pretty(&snapshot)?;
    println!("{}", json);
    Ok(())
}

pub async fn run_kt_verify(from: Option<i64>) -> Result<i32, Box<dyn std::error::Error>> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use ed25519_dalek::{Signature, Verifier};
    use sqlx::Row;
    use std::path::Path;

    let config = Config::from_env()?;
    let pool = db::init_pool(&config).await?;

    let key_path = Path::new(&config.opaque_oprf_key_path);
    let opaque_server = crate::opaque::OpaqueServer::load_or_generate(key_path)?;

    let kt_keys =
        crate::key_transparency::signing::KeyTransparencyKeys::derive(&opaque_server.setup)?;

    // Query latest snapshot
    let snapshot_row = sqlx::query(
        "SELECT id, tree_size, root_hash, signature FROM key_transparency_snapshots ORDER BY created_at DESC, id DESC LIMIT 1"
    )
    .fetch_optional(&pool)
    .await?;

    let Some(snapshot_row) = snapshot_row else {
        eprintln!("ERROR: no key transparency snapshots found");
        return Ok(1);
    };

    let snapshot_id: String = snapshot_row.get("id");
    let tree_size: i64 = snapshot_row.get("tree_size");
    let snapshot_root_hash_bytes: Vec<u8> = snapshot_row.get("root_hash");
    let signature_bytes: Vec<u8> = snapshot_row.get("signature");

    if snapshot_root_hash_bytes.len() != 32 {
        eprintln!(
            "ERROR: invalid root hash length in snapshot {}",
            snapshot_id
        );
        return Ok(1);
    }
    let mut snapshot_root_hash = [0u8; 32];
    snapshot_root_hash.copy_from_slice(&snapshot_root_hash_bytes);

    if signature_bytes.len() != 64 {
        eprintln!(
            "ERROR: invalid signature length in snapshot {}",
            snapshot_id
        );
        return Ok(1);
    }
    let signature = match Signature::from_slice(&signature_bytes) {
        Ok(s) => s,
        Err(_) => {
            eprintln!(
                "ERROR: failed to parse signature in snapshot {}",
                snapshot_id
            );
            return Ok(1);
        }
    };

    // Verify snapshot signature over (tree_size || root_hash)
    let signing_input = crate::key_transparency::snapshot::format_signing_input(
        tree_size as u64,
        &snapshot_root_hash,
    );
    if let Err(e) = kt_keys.verifying_key.verify(&signing_input, &signature) {
        eprintln!(
            "ERROR: snapshot signature verification failed for {}: {}",
            snapshot_id, e
        );
        return Ok(1);
    }

    // Recompute root over log up to tree_size
    let start_index = from.unwrap_or(0);
    let rows = sqlx::query(
        "SELECT username_token, identity_pubkey FROM key_transparency_log WHERE leaf_index >= ? ORDER BY leaf_index ASC"
    )
    .bind(start_index)
    .fetch_all(&pool)
    .await?;

    let all_leaves: Vec<crate::key_transparency::merkle::LogLeaf> = rows
        .into_iter()
        .map(|r| crate::key_transparency::merkle::LogLeaf {
            username_token: r.get("username_token"),
            identity_pubkey: r.get("identity_pubkey"),
        })
        .collect();

    let snapshot_leaves = if (tree_size as usize) <= all_leaves.len() {
        &all_leaves[..tree_size as usize]
    } else {
        eprintln!(
            "ERROR: log size {} is smaller than snapshot tree_size {}",
            all_leaves.len(),
            tree_size
        );
        return Ok(1);
    };

    let recomputed_root_hash = crate::key_transparency::merkle::compute_root(snapshot_leaves);

    if recomputed_root_hash != snapshot_root_hash {
        eprintln!("ERROR: recomputed root hash does not match snapshot root hash");
        return Ok(1);
    }

    let total_log_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_log")
        .fetch_one(&pool)
        .await?;

    let unverified_leaves = total_log_count.saturating_sub(tree_size);

    let output = serde_json::json!({
        "verified": true,
        "snapshot_id": snapshot_id,
        "tree_size": tree_size,
        "root_hash": URL_SAFE_NO_PAD.encode(snapshot_root_hash),
        "unverified_leaves_since_snapshot": unverified_leaves,
    });

    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(0)
}

pub fn run_session_types_validate(
    path: Option<PathBuf>,
) -> Result<i32, Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let file_path = path.unwrap_or_else(|| PathBuf::from(&config.session_types_config_path));

    match crate::sessions::load_session_types_from_file(
        &file_path,
        config.server_max_session_participants,
        config.server_max_sessions_per_room,
    ) {
        Ok(parsed_config) => {
            let sorted = parsed_config.sorted_types();
            println!("valid");
            println!("{} types:", sorted.len());
            for st in sorted {
                println!(
                    "  {} (extension_id={}, max_participants={}, max_per_room={})",
                    st.r#type, st.extension_id, st.max_participants, st.max_per_room
                );
            }
            Ok(0)
        }
        Err(crate::sessions::SessionTypesError::ConfigMissing { path }) => {
            let err_json = serde_json::json!({
                "error": "session_types_config_missing",
                "message": "Configuration file missing",
                "details": { "path": path }
            });
            eprintln!("{}", serde_json::to_string_pretty(&err_json)?);
            Ok(1)
        }
        Err(crate::sessions::SessionTypesError::InvalidConfig { line, reason }) => {
            let mut details = serde_json::Map::new();
            if let Some(l) = line {
                details.insert("line".to_string(), serde_json::json!(l));
            }
            details.insert("reason".to_string(), serde_json::json!(reason));

            let err_json = serde_json::json!({
                "error": "invalid_session_types_config",
                "message": "Validation failed",
                "details": details,
            });
            eprintln!("{}", serde_json::to_string_pretty(&err_json)?);
            Ok(1)
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            Ok(1)
        }
    }
}
