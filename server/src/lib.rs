pub mod altcha;
pub mod audit;
pub mod auth;
pub mod cleanup;
pub mod config;
pub mod config_ops;
pub mod db;
pub mod devices;
pub mod error;
pub mod gdpr;
pub mod invites;
pub mod limits;
pub mod login;
pub mod opaque;
pub mod permission_check;
pub mod permissions;
pub mod rate_limit;
pub mod registration;
pub mod roles;
pub mod routes;
pub mod session;

pub use altcha::{verify_altcha_payload, AltchaConfig, AltchaError};
pub use auth::AuthUser;
pub use cleanup::{
    audit::AuditJob, memory::MemoryStoresJob, rate_limits::RateLimitsJob, sessions::SessionsJob,
    welcomes::WelcomesJob, CleanupContext, CleanupContextOwned, CleanupError, CleanupJob,
    CleanupReport, Scheduler,
};
pub use config::Config;
pub use gdpr::{anonymise_user, build_export, DeletionSummary, GdprError};
pub use invites::{
    create_invite, get_invite_by_id, list_invites, revoke_invite, validate_and_consume_invite,
    ConsumedInvite, CreateInviteOptions, InviteError, ServerInvite,
};
pub use limits::ServerHardMax;
pub use login::LoginStore;
pub use opaque::{DefaultCipherSuite, OpaqueServer};
pub use rate_limit::{RateLimitConfig, RateLimitDecision, RateLimitError, RateLimitKey, Window};
pub use registration::RegistrationStore;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub opaque_server: Arc<OpaqueServer>,
    pub registration_store: Arc<RegistrationStore>,
    pub login_store: Arc<LoginStore>,
    pub altcha_config: Arc<AltchaConfig>,
    pub config: Arc<Config>,
    pub server_hard_max: Arc<ServerHardMax>,
}

impl axum::extract::FromRef<AppState> for SqlitePool {
    fn from_ref(state: &AppState) -> Self {
        state.pool.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<OpaqueServer> {
    fn from_ref(state: &AppState) -> Self {
        state.opaque_server.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<RegistrationStore> {
    fn from_ref(state: &AppState) -> Self {
        state.registration_store.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<LoginStore> {
    fn from_ref(state: &AppState) -> Self {
        state.login_store.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<AltchaConfig> {
    fn from_ref(state: &AppState) -> Self {
        state.altcha_config.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<Config> {
    fn from_ref(state: &AppState) -> Self {
        state.config.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<ServerHardMax> {
    fn from_ref(state: &AppState) -> Self {
        state.server_hard_max.clone()
    }
}
