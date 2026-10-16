use std::fs;
use std::path::Path;
use utoipa::{
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
    Modify, OpenApi,
};

use crate::error::ErrorResponse;
use crate::routes::{
    admin::{
        ExtensionProxyBlocklistReloadResponse, KeyTransparencyStatsResponse, ModelReloadResponse,
        SessionTypesReloadResponse,
    },
    admin_oprf::{RotateOprfRequest, RotateOprfResponse},
    attachments::{PresignRequest, PresignResponse, UserAvatarUploadForm},
    capabilities::{AltchaCapView, CapabilitiesResponse},
    devices::{DeviceResponse, ListDevicesResponse, UpdateDeviceNameRequest},
    health::HealthResponse,
    key_transparency::{
        BotKtHistoryEntry, BotKtHistoryResponse, BotKtResponse, KtAuditorSignature,
        KtSnapshotResponse, KtTreeHead, UserKtResponse,
    },
    preferences::WritePreferenceRequest,
    push_subscriptions::{PushSubscriptionListResponse, RegisterSubscriptionBody},
    read_state::WriteReadStateRequest,
    ready::ReadinessResponse,
    room_order::PatchRoomOrderRequest,
    sessions::{LogoutRequest, SessionListResponse, SessionResponseItem},
    users::{
        DeleteAccountRequest, PatchUserProfileRequest, UserLimitsResponse, UserLookupRequest,
        UserLookupResponse, UserProfileResponse,
    },
};
use crate::starred::list::{ListStarredItemsResponse, StarredItemCursor};
use crate::starred::write::StarRequest;
use crate::starred::StarredItemView;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("session_token")
                        .description(Some("Session token Bearer authentication"))
                        .build(),
                ),
            );
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Atoll Encrypted Chat API",
        version = "3.0.4",
        description = "OpenAPI specification for the Atoll server API. Derived from code annotations. Source of truth remains Server Spec v3.0.4. Endpoints without a security requirement are unauthenticated. Endpoints with the bearer security requirement accept a session token or a bot token where applicable. The auth endpoints are the entry points; the bearer scheme applies after registration or login."
    ),
    paths(
        crate::routes::health::handler,
        crate::routes::ready::handler,
        crate::routes::capabilities::handler,
        crate::routes::register::register_challenge,
        crate::routes::register::register_start,
        crate::routes::register::register_finish,
        crate::routes::login::login_start,
        crate::routes::login::login_finish,
        crate::routes::recover::recover_start,
        crate::routes::recover::recover_finish,
        crate::routes::sessions::logout,
        crate::routes::invites::validate_invite_public_handler,
        crate::routes::oprf::blind,
        crate::routes::link_preview::proxy_handler,
        crate::routes::extensions_proxy::proxy_handler,
        crate::routes::models::serve_stt_file_handler,
        crate::routes::models::serve_tts_file_handler,
        crate::routes::models::get_manifest_handler,
        crate::routes::sockudo::auth_handler,
        crate::routes::users::get_me,
        crate::routes::users::patch_me,
        crate::routes::users::delete_me,
        crate::routes::users::export_me,
        crate::routes::users::lookup_user,
        crate::routes::devices::list,
        crate::routes::devices::update_name,
        crate::routes::devices::revoke,
        crate::routes::sessions::list,
        crate::routes::sessions::revoke,
        crate::routes::push_subscriptions::register,
        crate::routes::push_subscriptions::list,
        crate::routes::push_subscriptions::revoke,
        crate::routes::sync::get_sync,
        crate::routes::read_state::write,
        crate::routes::room_order::patch_room_order,
        crate::routes::preferences::get,
        crate::routes::preferences::write,
        crate::routes::preferences::delete,
        crate::routes::starred::get_starred_items,
        crate::routes::starred::post_star,
        crate::routes::starred::delete_star,
        crate::routes::attachments::upload_avatar,
        crate::routes::bots::create_bot,
        crate::routes::bots::get_bot,
        crate::routes::bots::patch_bot,
        crate::routes::bots::delete_bot,
        crate::routes::bots::rotate_bot_keys,
        crate::routes::bots::upload_bot_avatar,
        crate::routes::bots::delete_bot_avatar,
        crate::routes::bots::get_bot_tokens,
        crate::routes::bots::create_token,
        crate::routes::bots::delete_token,
        crate::routes::room_bots::list_room_bots,
        crate::routes::room_bots::grant_bot,
        crate::routes::room_bots::patch_room_bot,
        crate::routes::room_bots::delete_room_bot,
        crate::routes::room_bots::post_bot_message,
        crate::routes::room_bots::post_bot_command,
        crate::routes::bots::ack_bot_command,
        crate::routes::bots::post_bot_messages,
        crate::routes::bots::get_bot_sync,
        crate::routes::bots::get_bot_settings_me,
        crate::routes::bots::get_bot_settings_owner,
        crate::routes::bots::patch_bot_setting_owner,
        crate::routes::bots::delete_bot_setting_owner,
        crate::routes::bots::enqueue_operator_queue_entry,
        crate::routes::bots::list_operator_queue,
        crate::routes::bots::get_operator_queue_entry,
        crate::routes::bots::respond_operator_queue_entry,
        crate::routes::publisher_keys::get_publisher_key,
        crate::routes::publisher_keys::publish_publisher_key,
        crate::routes::observer_stream::observer_stream_handler,
        crate::routes::key_transparency::get_user_kt_handler,
        crate::routes::key_transparency::get_bot_kt_handler,
        crate::routes::key_transparency::get_bot_kt_history_handler,
        crate::routes::key_transparency::get_kt_snapshot_handler,
        crate::routes::admin_oprf::rotate,
        crate::routes::admin::get_key_transparency_handler,
        crate::routes::admin::post_key_transparency_snapshot_handler,
        crate::routes::room_sessions::list_admin,
        crate::routes::admin::post_reload_models_handler,
        crate::routes::admin::post_reload_session_types_handler,
        crate::routes::admin::post_reload_extension_proxy_blocklist_handler,
    ),
    components(
        schemas(
            HealthResponse,
            ReadinessResponse,
            CapabilitiesResponse,
            AltchaCapView,
            crate::routes::register::AltchaChallengeResponse,
            crate::routes::register::RegisterStartRequest,
            crate::routes::register::RegisterStartResponse,
            crate::routes::register::RegisterFinishRequest,
            crate::routes::register::RegisterFinishResponse,
            crate::routes::login::LoginStartRequest,
            crate::routes::login::LoginStartResponse,
            crate::routes::login::LoginFinishRequest,
            crate::routes::login::LoginFinishResponse,
            crate::routes::recover::RecoverStartRequest,
            crate::routes::recover::RecoverStartResponse,
            crate::routes::recover::RecoverFinishRequest,
            crate::routes::recover::RecoverFinishResponse,
            crate::routes::invites::ValidateInviteResponse,
            crate::routes::oprf::OprfBlindRequest,
            crate::routes::oprf::OprfBlindResponse,
            crate::proxy_common::content_key::RequestEnvelope,
            crate::proxy_common::content_key::ResponseEnvelope,
            crate::proxy_common::content_key::ErrorPlaintext,
            crate::models::ModelFile,
            crate::models::ModelEntry,
            crate::routes::models::ManifestKindView,
            crate::routes::models::CombinedManifestResponse,
            crate::routes::sockudo::AuthRequest,
            crate::routes::sockudo::AuthResponse,
            crate::sessions::SessionTypeCapView,
            crate::models::TtsCapabilityModelView,
            crate::models::VoiceMetadata,
            UserProfileResponse,
            UserLimitsResponse,
            ErrorResponse,
            UserLookupRequest,
            UserLookupResponse,
            PatchUserProfileRequest,
            DeleteAccountRequest,
            DeviceResponse,
            ListDevicesResponse,
            UpdateDeviceNameRequest,
            crate::sync::device_names::DeviceStateRow,
            SessionResponseItem,
            SessionListResponse,
            LogoutRequest,
            RegisterSubscriptionBody,
            PushSubscriptionListResponse,
            crate::push::subscriptions::PushSubscriptionView,
            WriteReadStateRequest,
            crate::sync::read_state::ReadStateRow,
            PatchRoomOrderRequest,
            crate::sync::room_order::RoomOrderSyncState,
            WritePreferenceRequest,
            crate::sync::preferences::PreferenceRow,
            ListStarredItemsResponse,
            StarRequest,
            StarredItemView,
            crate::starred::StarredItemRow,
            StarredItemCursor,
            crate::attachments::AttachmentView,
            UserAvatarUploadForm,
            PresignRequest,
            PresignResponse,
            crate::sync::query::BotSettingSyncRow,
            crate::sync::query::SyncResponse,
            crate::routes::bots::CreateBotReq,
            crate::routes::bots::BotView,
            crate::routes::bots::OperatorView,
            crate::routes::bots::PatchBotReq,
            crate::routes::bots::RotateBotKeysReq,
            crate::routes::bots::CreateTokenResp,
            crate::routes::bots::BotTokenItem,
            crate::routes::bots::ListTokensResp,
            crate::routes::bots::PostBotMessagesReq,
            crate::routes::bots::BotSyncResponse,
            crate::routes::bots::BotSyncEvent,
            crate::routes::bots::GetBotSettingsMeResp,
            crate::routes::bots::GetBotSettingsOwnerResp,
            crate::routes::bots::QueueListEntryView,
            crate::routes::bots::ListOperatorQueueResp,
            crate::routes::bots::QueueDetailEntryView,
            crate::routes::bots::RespondOperatorQueueReq,
            crate::routes::bots::EnqueueOperatorQueueReq,
            crate::routes::bots::EnqueueOperatorQueueResponse,
            crate::routes::room_bots::RoomBotView,
            crate::routes::room_bots::ListRoomBotsResp,
            crate::routes::room_bots::GrantBotReq,
            crate::routes::room_bots::PatchRoomBotReq,
            crate::routes::room_bots::PostBotCommandReq,
            crate::routes::room_bots::PostBotCommandResp,
            crate::routes::room_bots::PostBotMessageReq,
            crate::routes::room_bots::PostBotMessageResp,
            crate::bots::settings::BotSettingBotView,
            crate::bots::settings::BotSettingOwnerView,
            crate::bots::settings::PatchBotSettingRequest,
            crate::routes::publisher_keys::PublisherKeyResponse,
            crate::routes::publisher_keys::PublishPublisherKeyRequest,
            UserKtResponse,
            BotKtResponse,
            BotKtHistoryEntry,
            BotKtHistoryResponse,
            KtSnapshotResponse,
            KtTreeHead,
            KtAuditorSignature,
            RotateOprfRequest,
            RotateOprfResponse,
            KeyTransparencyStatsResponse,
            crate::key_transparency::SnapshotView,
            crate::sessions::RoomSessionView,
            ModelReloadResponse,
            SessionTypesReloadResponse,
            crate::sessions::SessionTypeAdminView,
            ExtensionProxyBlocklistReloadResponse,
        )
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "Public", description = "Public endpoints"),
        (name = "User", description = "User endpoints"),
        (name = "Messaging", description = "Messaging endpoints"),
        (name = "Bots", description = "Bot account management, room grants, settings, commands, and publisher keys"),
        (name = "Key Transparency", description = "Key Transparency endpoints for users and bots"),
        (name = "Admin", description = "Admin administration and operations endpoints")
    )
)]
pub struct ApiDoc;

pub fn generate_openapi_file(out_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let doc = ApiDoc::openapi();
    let json = serde_json::to_string_pretty(&doc)?;

    if let Some(parent) = out_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    fs::write(out_path, &json)?;

    let bytes = json.len();
    let paths_count = doc.paths.paths.len();

    println!(
        "wrote {} ({} bytes, {} paths)",
        out_path.display(),
        bytes,
        paths_count
    );

    Ok(())
}
