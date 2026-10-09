pub mod auth;
pub mod connection;
pub mod scopes;
pub mod settings;

pub use auth::{validate_bot_token, BotAuthCtx, CallerIdentity};
pub use connection::BotConnectionState;
pub use scopes::{
    derive_mode, is_valid_scope, validate_dependencies, validate_scopes, Mode, ScopeError, SCOPES,
};
