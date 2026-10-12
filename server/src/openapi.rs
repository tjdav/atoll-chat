use std::fs;
use std::path::Path;
use utoipa::OpenApi;

use crate::routes::{
    capabilities::{AltchaCapView, CapabilitiesResponse},
    health::HealthResponse,
    ready::ReadinessResponse,
    users::{UserLimitsResponse, UserProfileResponse},
};

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
        crate::routes::users::get_me,
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
        )
    ),
    tags(
        (name = "Public", description = "Public endpoints"),
        (name = "User", description = "User endpoints")
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
