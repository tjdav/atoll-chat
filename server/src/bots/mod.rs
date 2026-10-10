pub mod auth;
pub mod connection;
pub mod idempotency;
pub mod scopes;
pub mod settings;

pub use auth::{validate_bot_token, BotAuthCtx, CallerIdentity};
pub use connection::BotConnectionState;
pub use idempotency::{
    check_or_reserve_request_id, record_response_code, validate_request_id, IdempotencyOutcome,
    ENDPOINT_BOT_COMMANDS, ENDPOINT_BOT_MESSAGES,
};
pub use scopes::{
    derive_mode, is_valid_scope, validate_dependencies, validate_scopes, Mode, ScopeError, SCOPES,
};
