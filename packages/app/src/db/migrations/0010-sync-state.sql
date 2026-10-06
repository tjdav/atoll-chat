CREATE TABLE IF NOT EXISTS sync_state (
  room_id     TEXT PRIMARY KEY,
  epoch       INTEGER NOT NULL DEFAULT 0,
  seq         INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_key    TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_events_at ON processed_events(processed_at);

CREATE TABLE IF NOT EXISTS mls_rooms (
  room_id                   TEXT PRIMARY KEY,
  local_client_id           TEXT,
  current_epoch             INTEGER NOT NULL DEFAULT 0,
  membership_status         TEXT NOT NULL DEFAULT 'pending',
  confirmed_transcript_hash BLOB,
  last_error                TEXT,
  joined_at                 INTEGER,
  updated_at                INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mls_rooms_status ON mls_rooms(membership_status);
