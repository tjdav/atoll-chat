use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use crate::auth::AuthUser;
use crate::calls::signal::{send_signal, SignalRequest, SignalResponse};
use crate::error::ApiError;
use crate::AppState;

pub async fn signal_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, call_id)): Path<(String, String)>,
    Json(req): Json<SignalRequest>,
) -> Result<(StatusCode, Json<SignalResponse>), ApiError> {
    let res = send_signal(
        &state.pool,
        &state.publisher,
        state.config.calling_enabled,
        &room_id,
        &call_id,
        &auth.user_id,
        req,
    )
    .await?;

    Ok((StatusCode::ACCEPTED, Json(res)))
}
