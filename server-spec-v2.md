Server Specification v2.0

Status: Stable — source of truth for all V2 implementation tasks.
Supersedes: Server Specification v1.0 (amended through §16.12).
Scope: Server-side contract only. Client implementation is out of scope and is covered by Client Specification v1.0.
Stack: Sockudo + Axum + SQLite + OPAQUE (opaque-ke 4.0.1) + VOPRF (voprf 0.5.0) + ALTCHA + S3 (or filesystem)
Deployment: Single VPS, Docker-based, self-hosted. Two containers: server (Axum + static SPA hosting) and sockudo. TLS terminates at a reverse proxy.

This document is a breaking revision. Nothing has been deployed; no migration path is required. Where V1 sections are unchanged, they are carried forward verbatim and marked. Where V2 changes them, the change is stated normatively.

Amendments to this document are tracked at §16. The V1 amendment log (§16.1–§16.12 of V1) is preserved in §17 for historical reference.

---

1. Product Summary

A self-hosted, end-to-end encrypted group messaging system with MLS-grade forward secrecy and post-compromise security. The server is an untrusted delivery service that never sees plaintext, keys, or meaningful metadata.

Layer — Technology
Delivery — Sockudo (WebSocket, Pusher v7)
API — Axum (Rust)
Database — SQLite (embedded in the Axum process)
Blob storage — S3 (default) or filesystem (fallback)
S3 client — rust-s3
MLS engine — Wire CoreCrypto 10.5.2 (client-side only)
Auth — OPAQUE (aPAKE) via opaque-ke 4.0.1
Username lookup — VOPRF (Ristretto255-SHA512) via voprf 0.5.0
Bot protection — ALTCHA Proof-of-Work v2 via altcha 0.2.0
Attachment encryption — C2SP chunked encryption (c2sp.org/chunked-encryption)
Static SPA hosting — Axum ServeDir with SPA fallback
Model hosting — Instance-local, external shared origin, or proxy-with-cache
TLS termination — External reverse proxy (Traefik via Coolify, or Caddy)

V2 architectural changes:

1. The server no longer stores plaintext usernames, display names, or device names. Identity is anchored in an OPRF token.
2. User-scoped state (read state, room order, device names, starred items, preferences) is durable and sequence-synced across a user's devices.
3. Message editing, reactions, threading, key transparency, link preview proxy, call signaling, hangouts, model hosting, starred items, and generic preferences are added.
4. Ambient presence remains refused. Call-scoped co-presence within calls and hangouts is permitted and is disclosed only to participants. It is never persisted.

---

2. Scope

2.1 In Scope — V2

Everything in V1 §2.1, plus:

- OPRF-based identity. Usernames, display names, and device names are opaque to the server.
- Recovery flow. Server-generated recovery codes; OPAQUE re-registration.
- User-scoped channels. private-user-{user_id} with durable, sequence-synced state.
- Multi-device sync. Read state, room order, device names, starred items, and preferences propagate across devices via user_seq.
- Generic preferences endpoint. Client-defined key/value preferences synced per user.
- Starred items. User-scoped stars for attachments, messages, and links.
- Message editing. Signed edit chain, edit_window_seconds enforced server-side.
- Reactions. Table, endpoints, aggregation, silent delivery.
- Threading. reply_to on messages.
- Room metadata updates. PATCH /rooms/:id with encrypted metadata.
- Room avatars. POST /users/me/avatar.
- Member pagination. Cursor-based pagination on GET /rooms/:id/members.
- Retention change preview. POST /rooms/:id/retention/preview.
- MLS adds coordination. pending_mls_adds.
- Key transparency. Append-only log with inclusion proofs and auditor signatures.
- Link preview proxy. Opt-in, SSRF-guarded, blind to URLs.
- Call signaling. WebRTC signaling events; TURN credential endpoint.
- Hangouts. Persistent, named, room-scoped voice spaces with in-memory occupancy.
- Model hosting. STT and TTS models, with local, external, and proxy hosting modes.
- Admin surfaces for new V2 features.
- Batched test execution model. See §5.30.

2.2 Presence and Co-Presence

Ambient presence is refused. The server does not track or expose who is online, when they were last seen, or what they are doing across the system. There are no presence channels. sessions.last_seen_at is not user-facing and is coarsened in any admin view. The client spec's "Last seen" setting is removed.

Call-scoped co-presence is permitted. Within a call or a hangout, the server knows in memory which room members are participating, in order to route media. This knowledge is disclosed only to participants of the same call or hangout. It is held in memory only and is never written to any persistent store or external system. Leaving a call or hangout removes the participant completely; no record remains.

2.3 Out of Scope — V2

- Ambient presence. No online/offline indicators, no presence channels, no last-seen exposure.
- Federation between servers
- Multi-tenancy
- Server-side key escrow
- Plaintext metadata on server
- Email or OAuth registration
- Anonymous accounts
- Plaintext message export
- Username changes
- Third-party CAPTCHA services
- Client-side data deletion
- Forcing peers to delete local copies
- Consent management UI
- TLS termination inside the Axum process
- ACME client inside the server
- MP4 fast-start enforcement
- Multi-range HTTP requests
- Range-restricted presigned URLs
- Message forwarding
- Message pinning
- GIF search
- Multi-node deployments. In-memory call and hangout occupancy requires a single Axum process. Multi-node requires a shared coordination layer and is out of scope for V2.
- Shared SPA hosting across instances. The SPA bundle is version-coupled to the server. Operators may place a CDN in front of CLIENT_STATIC_DIR for the same version, but the spec does not provide a cross-version shared origin.

2.4 Breaking Changes from V1

Change — V1 — V2
users.username — Plaintext — Removed. Replaced by users.username_token.
users.username_hash — Plaintext hash — Removed.
users.display_name — Plaintext — Removed. Replaced by users.encrypted_display.
devices.name — Plaintext — Removed. Device names are user-scoped sync state.
rooms.name_encrypted — TEXT column — Replaced by rooms.metadata (opaque encrypted JSON).
room_messages.reply_to — Absent — Added.
room_messages.edit_of, edit_sequence, edited_at — Absent — Added.
Reactions — Absent — New table.
Starred items — Absent — New table.
Generic preferences — Absent — New endpoints over user_preferences.
Key transparency — Absent — New tables + endpoints.
Call signaling — Absent — New events + endpoint.
Hangouts — Absent — New table + endpoints + in-memory occupancy.
Model hosting — Absent — New endpoints + three hosting modes.
client-read client event — Present — Removed. Replaced by POST /users/me/read-state.
GET /users/me/sync — Absent — New.
POST /oprf/blind — Absent — New.
POST /auth/recover/start, /finish — Absent — New.
Push payload sender_user_id — Present — Removed. Replaced by sender_ref.
OPRF key rotation — N/A — Immutable for account lifetime; compromise-only rotation.

---

3. Roles and Permissions

3.1 Global Roles

Role — Level — Permissions
owner — 100 — *
admin — 80 — user.manage, invite.unlimited, config.edit, room.force_delete, backup.manage
inviter — 50 — invite.limited
member — 10 — room.create, room.join, message.send

3.2 Room Roles

Role — Permissions
owner — Kick, delete room, promote/demote (Discord mode), transfer ownership, delete any message, edit metadata, change retention, set disappearing timer, create/delete hangouts
moderator — Kick (Discord mode), delete any message (Discord mode), create/delete hangouts (Discord mode)
member — Send messages, upload attachments, leave room, delete own messages, add reactions, edit own messages (within edit_window_seconds), create invites, join hangouts, create hangouts (Messenger mode)

3.3 Moderation Modes

Unchanged from V1 §3.3. In Discord mode, hangout creation and deletion are restricted to moderator+.

3.4 Enforcement Order

Unchanged from V1 §3.4.

3.5 Room Ownership Transfer

Unchanged from V1 §3.5.

---

4. Resource Limits

4.1 Three-Tier Model

Unchanged from V1 §4.1.

4.2 Default Limits

Key — Server hard max — Instance default — Instance range
file_size_bytes — 104857600 — 104857600 — 1 MB – 100 MB
room_size — 1000 — 100 — 2 – 1000
rooms_per_user — 500 — 50 — 1 – 500
devices_per_user — 20 — 10 — 1 – 20
keypackages_per_device — 50 — 20 — 5 – 50
message_size_bytes — 65536 — 16384 — 256 B – 64 KB
attachment_retention_days — 365 — 0 (forever) — 0 – 365
call_max_participants — 50 — 8 — 2 – 50
reactions_per_message — 50 — 50 — 1 – 50
edit_window_seconds — 86400 — 900 — 60 – 86400
sync_event_retention_days — 365 — 90 — 30 – 365
key_transparency_retention_days — 3650 — 3650 — 365 – 3650
hangouts_per_room — 25 — 10 — 1 – 25
hangout_max_participants — 50 — 12 — 2 – 50
starred_items_per_user — 100000 — 10000 — 100 – 100000

hangout_max_participants: conservative default of 12. For a mesh call without an SFU, 25 participants means 24 outbound and 24 inbound media streams per client. Operators who want larger hangouts can raise this up to SERVER_MAX_HANGOUT_PARTICIPANTS and accept the operational cost.

starred_items_per_user: bounds the initial sync response. A power user with 100,000 stars is unusual; the hard max protects against a runaway client.

4.3 Per-Entity Overrides

Unchanged from V1 §4.3, plus rooms.hangouts_per_room override (owner-set, bounded by instance).

4.4 Effective Limits Exposure

Unchanged from V1 §4.4. GET /rooms/:id continues to return effective_max_file_size_bytes and effective_message_retention_days.

4.5 Cleanup Jobs

All jobs run on the shared hourly scheduler.

Job — Retention — Notes
Session cleanup — 30 days after expiry or revocation — V1.
Rate limit table — 24 hours — V1.
Audit log — AUDIT_RETENTION_DAYS (90) — V1.
Attachment pruning — Three-tier effective retention — V1.
Welcome expiry — 7 days — V1.
Message retention — Per-room, falling to instance default — V1.
Registration state — 5-minute TTL — V1.
Login state — 5-minute TTL — V1.
Sync state pruning — sync_event_retention_days — V2. Deletes user-scoped state rows older than the window whose user_seq is below the current max.
Push subscription expiry — 90 days of inactivity — V2. Revokes and deletes push_subscriptions with last_used_at < now - 90d.
Key transparency retention — key_transparency_retention_days — V2.
Recovery code consumption — Immediate — V2. Consumed codes are marked, not deleted, for audit.
Call state cleanup — 24 hours after call end — V2. Deletes call_sessions rows and any dangling participants.
Hangout metadata pruning (optional) — 90 days of zero occupancy, disabled by default — V2. A hangout is a persistent space. Do not enable without operator intent.

No cleanup job is required for hangout occupancy. Occupancy is in-memory and self-cleaning. There is nothing to prune.

No cleanup job is required for model files. Models are immutable and content-addressed by version.

---

5. Environment Variables

Follows Coolify conventions. All variables are optional unless marked required.

5.1 Application

APP_ENV=production
APP_URL=https://chat.example.com
APP_NAME=Encrypted Chat
LOG_LEVEL=info
CLIENT_STATIC_DIR=/app/client

Log policy. The server writes structured logs to stdout and stderr only. It does not write log files. Container runtime captures and rotates stdout. The server does not store request logs persistently. No IP addresses, URLs, or user identifiers are written by the server to any persistent store. Retention of stdout is the operator's responsibility and must be documented in the operator's privacy policy.

Hangout occupancy is never logged. Not to stdout, not to stderr, not to any metrics pipeline, not to any tracing system. See §12.

SPA deployment note. Operators with multiple instances of the same server version MAY place a CDN in front of CLIENT_STATIC_DIR to reduce bandwidth. This is a deployment choice, not a server feature. The SPA bundle is version-coupled to the server; do not serve an SPA bundle from a different version than the server behind it.

5.2 Server

SERVER_BIND=0.0.0.0:8080
SERVER_WORKERS=4

5.3 Database

DB_PATH=/data/app.db
DB_BUSY_TIMEOUT_MS=5000

5.4 Sessions

SESSION_EXPIRY_DAYS=30
SESSION_SLIDING=true

5.5 Server Hard Limits

SERVER_MAX_FILE_SIZE_BYTES=104857600
SERVER_MAX_ROOM_SIZE=1000
SERVER_MAX_ROOMS_PER_USER=500
SERVER_MAX_DEVICES_PER_USER=20
SERVER_MAX_KEYPACKAGES_PER_DEVICE=50
SERVER_MAX_MESSAGE_SIZE_BYTES=65536
SERVER_MAX_ATTACHMENT_RETENTION_DAYS=365
SERVER_MAX_EDIT_WINDOW_SECONDS=86400
SERVER_MAX_REACTIONS_PER_MESSAGE=50
SERVER_MAX_HANGOUTS_PER_ROOM=25
SERVER_MAX_HANGOUT_PARTICIPANTS=50
SERVER_MAX_STARRED_ITEMS_PER_USER=100000

5.6 Rate Limits

RATE_INVITE_CREATE_HOURLY=50
RATE_INVITE_CREATE_DAILY=200
RATE_INVITE_REDEEM_PER_MIN=10
RATE_KP_CLAIM_PER_MIN=30
RATE_KP_CLAIM_HOURLY=200
RATE_LOGIN_PER_MIN=10
RATE_LOGIN_LOCKOUT_MIN=15
RATE_PRESIGN_PER_MIN=60
RATE_OPRF_BLIND_PER_MIN=30
RATE_OPRF_BLIND_PER_HOUR=300
RATE_RECOVER_START_PER_MIN=5
RATE_RECOVER_START_PER_HOUR=20
RATE_LOOKUP_PER_MIN=30
RATE_EDIT_PER_MIN=30
RATE_REACTION_PER_MIN=60
RATE_LINK_PREVIEW_PER_MIN=10
RATE_TURN_CREDENTIALS_PER_MIN=10
RATE_HANGOUT_CREATE_HOURLY=20
RATE_HANGOUT_CREATE_DAILY=100
RATE_HANGOUT_JOIN_PER_MIN=30
RATE_HANGOUT_HEARTBEAT_PER_MIN=10
RATE_MODEL_DOWNLOAD_PER_MIN=30

5.7 Transport Security

Unchanged from V1 §5.7.

5.8 OPAQUE and OPRF

OPAQUE_OPRF_KEY_PATH=/data/oprf.key
USERNAME_OPRF_ENABLED=true

5.9 Backups

Unchanged from V1 §5.9.

5.10 Push Notifications

Unchanged from V1 §5.10.

5.11 ALTCHA

Unchanged from V1 §5.11.

5.12 Storage Backend

Unchanged from V1 §5.12.

5.13 Attachment Format

Unchanged from V1 §5.13.

5.14 Moderation

Unchanged from V1 §5.14.

5.15 Invite Defaults

Unchanged from V1 §5.15.

5.16 Safety Numbers

Unchanged from V1 §5.16.

5.17 Audit Log

AUDIT_RETENTION_DAYS=90

5.18 Cleanup Scheduler

Unchanged from V1 §5.18.

5.19 Sockudo

SOCKUDO_URL=http://sockudo:6001
SOCKUDO_APP_ID=chat
SOCKUDO_APP_KEY=auto
SOCKUDO_APP_SECRET=auto
SOCKUDO_ENABLE_CLIENT_EVENTS=true

5.20 GDPR

Unchanged from V1 §5.20.

5.21 TLS Termination

Unchanged from V1 §5.21.

5.22 Key Transparency

KEY_TRANSPARENCY_ENABLED=true
KEY_TRANSPARENCY_LOG_PATH=/data/kt-log
KEY_TRANSPARENCY_AUDITOR_KEYS=

5.23 Link Preview Proxy

LINK_PREVIEW_PROXY_ENABLED=false
LINK_PREVIEW_PROXY_TIMEOUT_SECONDS=5
LINK_PREVIEW_PROXY_MAX_BYTES=1048576

5.24 Calls

CALLING_ENABLED=false
TURN_URL=
TURN_SHARED_SECRET=
TURN_TTL_SECONDS=600
CALL_MAX_PARTICIPANTS=8

5.25 Username OPRF

OPRF_BLIND_ENABLED=true

5.26 Hangouts

HANGOUTS_ENABLED=true
SERVER_MAX_HANGOUTS_PER_ROOM=25
SERVER_MAX_HANGOUT_PARTICIPANTS=50
HANGOUT_MAX_PARTICIPANTS=12
HANGOUT_HEARTBEAT_INTERVAL_SECONDS=15
HANGOUT_HEARTBEAT_TIMEOUT_SECONDS=45
HANGOUT_OCCUPANCY_DEBOUNCE_MS=1000

5.27 Model Hosting

MODEL_HOSTING_ENABLED=true
MODEL_HOSTING_MODE=local
MODEL_EXTERNAL_BASE_URL=
MODEL_STORAGE_PATH=/data/models
STT_MODELS_PATH=/data/models/stt
TTS_MODELS_PATH=/data/models/tts
STT_DEFAULT_MODEL=moonshine-tiny
TTS_DEFAULT_MODEL=supertonic-3
MODEL_DOWNLOAD_RATE_PER_MIN=30
BACKUP_INCLUDE_MODELS=false

5.28 Generic Preferences

No environment variables. The endpoint is always enabled when authenticated.

5.29 Starred Items

No environment variables. The feature is always enabled when authenticated.

5.30 Batched Test Execution Model

See §5.30 in V2 spec.

---

6. Client Interface Contract

Unchanged from earlier specification.

---

7. Data Model

...

7.10 Key Transparency and Ops

CREATE TABLE key_transparency_log (
    leaf_index      INTEGER PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username_token  TEXT NOT NULL,
    identity_pubkey TEXT NOT NULL,
    added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kt_user ON key_transparency_log(user_id);
CREATE INDEX idx_kt_added ON key_transparency_log(added_at);

CREATE TABLE key_transparency_snapshots (
    id           TEXT PRIMARY KEY,
    tree_size    INTEGER NOT NULL,
    root_hash    BLOB NOT NULL,
    signature    BLOB,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---

8. API Surface

...

8.3 Admin

Unchanged from V1 §8.3, plus:

Method — Path — Purpose
POST — /admin/oprf/rotate — Rotate the username OPRF key (catastrophic)
GET — /admin/key-transparency — Read KT log stats
POST — /admin/key-transparency/snapshot — Trigger a signed snapshot
GET — /admin/rooms/:id/hangouts — Read-only list of hangouts (metadata only, no occupancy)
POST — /admin/models/reload — Reload the model manifest

8.8 Event Catalog

Room events (private-room-{room_id}):
...
kt.snapshot

---

14. Audit Log and Privacy

...

14.8 Audit Actions

V1 actions plus:
...
- kt.snapshot

---

15. Amendment Process

Unchanged from V1 §15.

---

16. Amendments (V2)

16.1 Amendment 13 — OPRF Identity Layer — 2026-09-29
16.2 Amendment 14 — Recovery Flow — 2026-09-29
16.3 Amendment 15 — User-Scoped Sync — 2026-09-29
16.4 Amendment 16 — Room Metadata and Retention Preview — 2026-09-29
16.5 Amendment 17 — Message Editing and Threading — 2026-09-29
16.6 Amendment 18 — Reactions — 2026-09-29
16.7 Amendment 19 — Key Transparency — 2026-09-29
16.8 Amendment 20 — Link Preview Proxy — 2026-09-29
16.9 Amendment 21 — Call Signaling and TURN — 2026-09-29
16.10 Amendment 22 — Member Pagination and Avatar Upload — 2026-09-29
16.11 Amendment 23 — Removal of Presence — 2026-09-29
16.12 Amendment 24 — Push Payload Metadata Reduction — 2026-09-29
16.13 Amendment 25 — Hangouts — 2026-09-30
16.14 Amendment 26 — Model Hosting — 2026-09-30
16.15 Amendment 27 — Starred Items — 2026-09-30
16.16 Amendment 28 — Generic Preferences Endpoint — 2026-09-30
16.17 Amendment 29 — Hangout Clarifications — 2026-09-30
16.18 Amendment 30 — OPRF Key Derivation from Serialized ServerSetup — 2026-10-01
16.19 Amendment 31 — Username Token Format and Length — 2026-10-01
16.20 Amendment 32 — Lookup Response Semantics — 2026-10-01
16.21 Amendment 33 — Identity Bounds and Deletion Behavior — 2026-10-01
16.22 Amendment 34 — Batched Test Execution Model — 2026-10-01

16.35 Amendment 35 — Key Transparency Scale and Proof Endpoints — 2026-10-01

Adopted Interpretation B (RFC 6962-lite) for Key Transparency. Specified RFC 6962 SHA-256 Merkle tree hashing with 0x00 leaf and 0x01 internal node domain separators. Defined Ed25519 STH signature structure. Added public endpoints GET /key-transparency/sth and GET /key-transparency/proof for client inclusion proof verification.

Sections affected: §2.1, §5.22, §7.10, §8.1, §8.3, §16.35.

Affected tasks: 34a.

---

17. V1 Amendment Log (Historical)

...

18. Document Status

This is the contract for the server side of the system.
