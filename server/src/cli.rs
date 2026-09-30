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
    let res = crate::opaque::rotate_oprf_key(&pool, &config, None).await?;
    println!("OPRF key rotated.");
    println!("Backup saved to: {}", res.backup_path.display());
    println!("Users affected: {}", res.users_affected);
    println!("All users must re-register. Existing sessions remain valid until they expire.");
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
