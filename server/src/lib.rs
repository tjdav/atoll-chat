pub mod altcha;
pub mod config;
pub mod db;
pub mod error;
pub mod login;
pub mod opaque;
pub mod permissions;
pub mod registration;
pub mod roles;
pub mod routes;
pub mod session;

pub use altcha::{verify_altcha_payload, AltchaConfig, AltchaError};
pub use config::Config;
pub use login::LoginStore;
pub use opaque::{DefaultCipherSuite, OpaqueServer};
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
