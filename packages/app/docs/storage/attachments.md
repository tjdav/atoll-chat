# Attachments Domain Contract

## 1. Purpose
The `attachments` table caches metadata about encrypted blobs the client has seen: full message attachments, room avatars, user avatars, session icons, and custom stickers.

## 2. Schema
The `attachments` table is defined in `packages/app/src/db/migrations/0005-attachments-reactions.sql`:

```sql
CREATE TABLE IF NOT EXISTS attachments (
  file_id             TEXT PRIMARY KEY,
  room_id             TEXT,
  purpose             TEXT NOT NULL,
  content_type        TEXT,
  plaintext_size      INTEGER,
  encrypted_size      INTEGER,
  thumbnail_file_id   TEXT,
  duration_ms         INTEGER,
  uploaded_at         INTEGER,
  downloaded_at       INTEGER,
  cached_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_room ON attachments(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_purpose ON attachments(purpose);
```

- `file_id`: Primary key. The SHA-256 hash of the padded ciphertext encoded in unpadded base64url.
- `room_id`: Optional room identifier for room-scoped attachments. `NULL` for user avatars or room-independent blobs.
- `purpose`: High-level category string ("message", "room-avatar", "user-avatar", "session-icon", "sticker").
- `content_type`: Optional plaintext MIME type string.
- `plaintext_size`: Padded plaintext size in bytes.
- `encrypted_size`: Ciphertext size in bytes (includes 56-byte header).
- `thumbnail_file_id`: Reference to another row in `attachments` when a thumbnail exists.
- `duration_ms`: Audio/video duration in milliseconds.
- `uploaded_at`: Epoch timestamp (ms) when uploaded to server, or `NULL`.
- `downloaded_at`: Epoch timestamp (ms) when cached locally, or `NULL`.
- `cached_at`: Epoch timestamp (ms) when metadata row was created/updated.

## 3. The `file_id`
`file_id` is the SHA-256 digest of the padded ciphertext. It is the opaque identifier used by server endpoints to reference media blobs. It is NOT an encryption key; cryptographic keys are kept separate from database rows.

## 4. The Attachments Repository
Located at `packages/app/src/lib/db/repositories/attachments.js` and instantiated via `createAttachmentsRepository({ db })`.

### Methods
- `get(fileId)`: Returns single attachment row or `undefined`.
- `upsert(attachment)`: Inserts or partially updates an attachment row. `cached_at` is always set to `Date.now()`.
- `markUploaded(fileId, { encryptedSize } = {})`: Sets `uploaded_at` timestamp and optional `encrypted_size`.
- `markDownloaded(fileId)`: Sets `downloaded_at` timestamp.
- `getMany(fileIds)`: Returns array of rows matching input `fileIds`.
- `listByRoom(roomId, { limit, cursor })`: Lists room attachments sorted by `cached_at DESC`.
- `listByPurpose(purpose, { limit, cursor })`: Lists attachments by purpose sorted by `cached_at DESC`.
- `remove(fileId)`: Hard deletes an attachment row.
- `countByRoom(roomId)`: Returns total count of attachments for a room.
- `clearAll()`: Hard deletes all rows.

## 5. `getMany` and the `IN` Clause
`getMany(fileIds)` dynamically constructs SQL placeholders based on `fileIds.length` (e.g. `WHERE file_id IN (?, ?, ?)`). Bound parameters are passed separately to ensure complete protection against SQL injection.

## 6. Purposes
The client spec identifies five primary purposes:
- `"message"`
- `"room-avatar"`
- `"user-avatar"`
- `"session-icon"`
- `"sticker"`

There is no `CHECK` constraint on `purpose`; unknown or future values are stored verbatim and handled by renderers.

## 7. Thumbnails
A thumbnail is stored as its own row in `attachments` with its own unique `file_id`. The parent attachment references the thumbnail's `file_id` via `thumbnail_file_id`.

## 8. Blob Storage
This repository manages metadata only. Disk/OPFS storage of actual encrypted bytes is managed separately by the `lib/blobs` subsystem.

## 9. Cache Eviction
`cached_at` and `downloaded_at` fields support future LRU cache eviction and blob cleanup tasks.

## 10. Population
The repository is fully exported via `createRepositories({ db })` in `packages/app/src/lib/db/repositories/index.js` and is ready for integration into storage plugins and UI components.
