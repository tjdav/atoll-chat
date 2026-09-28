pub mod altcha;
pub mod attachments;
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
pub mod key_packages;
pub mod limits;
pub mod login;
pub mod middleware;
pub mod opaque;
pub mod permission_check;
pub mod permissions;
pub mod rate_limit;
pub mod registration;
pub mod roles;
pub mod room_invites;
pub mod room_messages;
pub mod rooms;
pub mod routes;
pub mod session;
pub mod sockudo;
pub mod storage;
pub mod welcomes;

use axum::{
    routing::{delete, get, post},
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

pub use altcha::{verify_altcha_payload, AltchaConfig, AltchaError};
pub use attachments::{
    delete_attachment, get_attachment, read_attachment_bytes, read_attachment_range,
    upload_attachment, AttachmentError, AttachmentView, UploadRequest,
};
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
pub use key_packages::{
    claim_key_package, count_unconsumed, upload_key_packages, ClaimedKeyPackage, KeyPackageError,
    KeyPackageSummary, UnconsumedCount, UploadedKeyPackage,
};
pub use limits::ServerHardMax;
pub use login::LoginStore;
pub use opaque::{DefaultCipherSuite, OpaqueServer};
pub use rate_limit::{RateLimitConfig, RateLimitDecision, RateLimitError, RateLimitKey, Window};
pub use registration::RegistrationStore;
pub use room_messages::{
    get_current_epoch, get_message_ciphertext, list_messages, submit_message, MessageContentType,
    RoomMessageError, RoomMessageView, SubmitOutcome, SubmitRequest,
};
pub use sockudo::{Publisher, SockudoConfig, SockudoError};
use sqlx::SqlitePool;
use std::sync::Arc;
pub use storage::{build_storage, FsStorage, S3Storage, Storage, StorageError};
pub use welcomes::{
    consume_welcome, create_welcome, get_welcome_data, list_pending, WelcomeError, WelcomeView,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub opaque_server: Arc<OpaqueServer>,
    pub registration_store: Arc<RegistrationStore>,
    pub login_store: Arc<LoginStore>,
    pub altcha_config: Arc<AltchaConfig>,
    pub config: Arc<Config>,
    pub server_hard_max: Arc<ServerHardMax>,
    pub sockudo_config: Arc<SockudoConfig>,
    pub sockudo_publisher: Arc<Publisher>,
    pub storage: Arc<dyn Storage>,
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

impl axum::extract::FromRef<AppState> for Arc<SockudoConfig> {
    fn from_ref(state: &AppState) -> Self {
        state.sockudo_config.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<Publisher> {
    fn from_ref(state: &AppState) -> Self {
        state.sockudo_publisher.clone()
    }
}

impl axum::extract::FromRef<AppState> for Arc<dyn Storage> {
    fn from_ref(state: &AppState) -> Self {
        state.storage.clone()
    }
}

pub fn build_app(state: AppState) -> Router {
    let api_routes = Router::new()
        .route(
            "/admin/config",
            get(routes::admin::get_config_handler).patch(routes::admin::patch_config_handler),
        )
        .route(
            "/admin/limits",
            get(routes::admin::get_limits_handler).patch(routes::admin::patch_limits_handler),
        )
        .route("/admin/audit", get(routes::admin::get_audit_handler))
        .route("/capabilities", get(routes::capabilities::handler))
        .route("/roles", get(routes::roles::handler))
        .route(
            "/auth/register/challenge",
            get(routes::register::register_challenge),
        )
        .route(
            "/auth/register/start",
            post(routes::register::register_start),
        )
        .route(
            "/auth/register/finish",
            post(routes::register::register_finish),
        )
        .route("/auth/login/start", post(routes::login::login_start))
        .route("/auth/login/finish", post(routes::login::login_finish))
        .route(
            "/users/me",
            get(routes::users::get_me)
                .patch(routes::users::patch_me)
                .delete(routes::users::delete_me),
        )
        .route("/users/me/export", get(routes::users::export_me))
        .route("/users/me/sessions", get(routes::sessions::list))
        .route("/users/me/sessions/{id}", delete(routes::sessions::revoke))
        .route("/users/me/devices", get(routes::devices::list))
        .route("/users/me/devices/{id}", delete(routes::devices::revoke))
        .route("/auth/logout", post(routes::sessions::logout))
        .route(
            "/admin/invites",
            post(routes::invites::create_invite_handler).get(routes::invites::list_invites_handler),
        )
        .route(
            "/admin/invites/{id}",
            delete(routes::invites::revoke_invite_handler),
        )
        .route(
            "/invites/{code}",
            get(routes::invites::validate_invite_public_handler),
        )
        .route(
            "/rooms",
            post(routes::rooms::create).get(routes::rooms::list),
        )
        .route("/rooms/join", post(routes::room_invites::join))
        .route(
            "/rooms/{id}",
            get(routes::rooms::get).delete(routes::rooms::delete),
        )
        .route(
            "/rooms/{id}/invites",
            post(routes::room_invites::create).get(routes::room_invites::list),
        )
        .route(
            "/rooms/{id}/invites/{invite_id}",
            delete(routes::room_invites::revoke),
        )
        .route("/rooms/{id}/leave", post(routes::rooms::leave))
        .route(
            "/rooms/{id}/members",
            get(routes::rooms::list_members).post(routes::rooms::add_member),
        )
        .route(
            "/rooms/{id}/members/{uid}",
            delete(routes::rooms::kick_member),
        )
        .route(
            "/rooms/{id}/members/{uid}/promote",
            post(routes::rooms::promote_member),
        )
        .route(
            "/rooms/{id}/members/{uid}/demote",
            post(routes::rooms::demote_member),
        )
        .route(
            "/rooms/{id}/transfer",
            post(routes::rooms::transfer_ownership),
        )
        .route("/keypackages", post(routes::key_packages::upload))
        .route("/keypackages/count", get(routes::key_packages::count))
        .route("/keypackages/claim", post(routes::key_packages::claim))
        .route(
            "/rooms/{id}/messages",
            post(routes::room_messages::submit).get(routes::room_messages::list),
        )
        .route(
            "/rooms/{id}/messages/{message_id}/ciphertext",
            get(routes::room_messages::get_ciphertext),
        )
        .route("/rooms/{id}/epoch", get(routes::room_messages::get_epoch))
        .route("/welcomes", get(routes::welcomes::list))
        .route("/welcomes/{id}", get(routes::welcomes::get))
        .route("/welcomes/{id}/consume", post(routes::welcomes::consume))
        .route("/sockudo/auth", post(routes::sockudo::auth))
        .route(
            "/rooms/{id}/pending-removes",
            get(routes::pending_removes::list),
        )
        .route(
            "/rooms/{id}/pending-removes/{remove_id}/consume",
            post(routes::pending_removes::consume),
        )
        .route("/rooms/{id}/attachments", post(routes::attachments::upload))
        .route(
            "/attachments/{id}",
            get(routes::attachments::download).delete(routes::attachments::delete_attachment),
        )
        .route(
            "/attachments/{id}/presign",
            post(routes::attachments::presign),
        );

    let cors = if state.config.app_env == "development" {
        tracing::info!("CORS mode: permissive (development)");
        CorsLayer::permissive()
    } else {
        if let Some(app_url) = &state.config.app_url {
            tracing::info!("CORS mode: restricted to {}", app_url);
            CorsLayer::new().allow_origin(
                app_url
                    .parse::<axum::http::HeaderValue>()
                    .expect("Invalid APP_URL for CORS"),
            )
        } else {
            tracing::info!("CORS mode: no origin allowed (APP_URL missing)");
            CorsLayer::new()
        }
    };

    let mut app = Router::new()
        .route("/health", get(routes::health::handler))
        .route("/ready", get(routes::ready::handler))
        .nest("/api/v1", api_routes);

    if let Some(dir) = &state.config.client_static_dir {
        app = app.fallback_service(routes::r#static::build_spa_service(dir));
    }

    app.layer(TraceLayer::new_for_http())
        .layer(cors)
        .layer(axum::middleware::from_fn_with_state(
            state.config.clone(),
            middleware::https::enforce_https,
        ))
        .with_state(state)
}
