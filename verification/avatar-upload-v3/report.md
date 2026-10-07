# Empirical Verification Report: Avatar Upload V3 Alignment (Phase 13 / V3 Spec §6.4, §6.10, §7.7, §8.2.7, §12)

## Baseline Summary
- **Verification Target:** `POST /api/v1/users/me/avatar` contract alignment and test coverage.
- **Spec References:** V3 Spec §4.1, §6.4, §6.10, §7.7, §8.2.7, §12.
- **Batch Assignment:** `storage` batch (`server/tests/user_avatar.rs`).

## Verification Items
1. Endpoint & Auth: POST /api/v1/users/me/avatar accepts multipart single file part with C2SP params, requires auth, returns 201 Created and Cache-Control: no-store. Verified.
2. Database Row & Discriminator: Stored attachments row has room_id = NULL and uploader_id = caller user ID. Purpose string is client-side context only. Verified.
3. Effective Limit Resolution: Resolves max_file_size_bytes override from users table falling back to config default and server hard max. Oversize uploads reject with HTTP 413 file_too_large. Verified.
4. Storage & Opacity: Operates as C2SP opaque pipe without inspecting/decrypting payload. Server accepts arbitrary non-C2SP bytes. Verified.
5. Profile Invariant & Isolation: Avatar upload does not modify users.profile, does not bump users.profile_version, and emits zero user.updated events. Verified.
6. Cross-User Isolation: Cross-user endpoints POST /users/lookup and GET /rooms/:id/members do not expose avatar attachment ID or file ID. Verified.
7. S3 Backend: Avatar upload path functions correctly under S3 backend configuration or is tested via S3 test patterns. Verified.
