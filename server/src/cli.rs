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
