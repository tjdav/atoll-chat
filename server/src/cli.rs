use clap::{Parser, Subcommand};
use std::path::PathBuf;

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

    /// Restore from a backup
    Restore {
        #[arg(long)]
        from: PathBuf,

        #[arg(long, default_value_t = false)]
        confirm: bool,
    },
}
