pub mod auth;
pub mod connection;
pub mod declarations;
pub mod scopes;
pub mod settings;

pub use auth::{validate_bot_token, BotAuthCtx, CallerIdentity};
pub use connection::BotConnectionState;
pub use declarations::validate_declarations_top_level;
pub use scopes::{
    derive_mode, is_valid_scope, validate_dependencies, validate_scopes, Mode, ScopeError, SCOPES,
};
