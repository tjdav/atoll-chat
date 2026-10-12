use std::fs;
use std::path::Path;
use utoipa::{
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
    Modify, OpenApi,
};

use crate::error::ErrorResponse;
use crate::routes::{
    attachments::{
        PresignRequest, PresignResponse, RoomAttachmentUploadForm, UserAvatarUploadForm,
    },
    capabilities::{AltchaCapView, CapabilitiesResponse},
    devices::{DeviceResponse, ListDevicesResponse, UpdateDeviceNameRequest},
    health::HealthResponse,
    preferences::WritePreferenceRequest,
    push_subscriptions::{PushSubscriptionListResponse, RegisterSubscriptionBody},
    reactions::{AddReactionInput, AddReactionResponse, ListReactionsResponse},
    read_state::WriteReadStateRequest,
    ready::ReadinessResponse,
    room_messages::{
        EditMessageRequest, EpochResponse, ListQuery, MessageCiphertextResponse,
        SubmitMessageRequest,
    },
    room_order::PatchRoomOrderRequest,
    sessions::{LogoutRequest, SessionListResponse, SessionResponseItem},
    users::{
        DeleteAccountRequest, PatchUserProfileRequest, UserLimitsResponse, UserLookupRequest,
        UserLookupResponse, UserProfileResponse,
    },
    welcomes::{ConsumeWelcomeResponse, WelcomeDetailResponse, WelcomesListResponse},
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
        description = "OpenAPI specification for the Atoll server API. Derived from code annotations. Source of truth remains Server Spec v3.0.4."
    ),
    paths(
        crate::routes::health::handler,
        crate::routes::ready::handler,
        crate::routes::capabilities::handler,
        crate::routes::sessions::logout,
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
        crate::routes::room_messages::list,
        crate::routes::room_messages::submit,
        crate::routes::room_messages::edit,
        crate::routes::room_messages::delete_message,
        crate::routes::reactions::add,
        crate::routes::reactions::remove,
        crate::routes::attachments::upload,
        crate::routes::attachments::download,
        crate::routes::attachments::delete_attachment,
        crate::routes::welcomes::list,
        crate::routes::welcomes::get,
    ),
    components(
        schemas(
            HealthResponse,
            ReadinessResponse,
            CapabilitiesResponse,
            AltchaCapView,
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
            RoomAttachmentUploadForm,
            PresignRequest,
            PresignResponse,
            crate::sync::query::BotSettingSyncRow,
            crate::sync::query::SyncResponse,
            crate::room_messages::RoomMessageView,
            crate::room_messages::ListMessagesResult,
            crate::room_messages::MessageCursor,
            crate::room_messages::SubmitOutcome,
            SubmitMessageRequest,
            EditMessageRequest,
            ListQuery,
            EpochResponse,
            MessageCiphertextResponse,
            crate::reactions::list::ReactionSummary,
            AddReactionInput,
            AddReactionResponse,
            ListReactionsResponse,
            crate::welcomes::WelcomeView,
            WelcomesListResponse,
            WelcomeDetailResponse,
            ConsumeWelcomeResponse,
        )
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "Public", description = "Public endpoints"),
        (name = "User", description = "User endpoints"),
        (name = "Messaging", description = "Messaging endpoints")
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
