pub mod config;
pub mod db;
pub mod error;
pub mod opaque;
pub mod permissions;
pub mod registration;
pub mod roles;
pub mod routes;

pub use opaque::{DefaultCipherSuite, OpaqueServer};
pub use registration::RegistrationStore;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub opaque_server: Arc<OpaqueServer>,
    pub registration_store: Arc<RegistrationStore>,
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
