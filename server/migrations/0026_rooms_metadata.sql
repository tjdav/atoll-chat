-- V2 Amendment 16: opaque room metadata blob.
--
-- V1 stored a single encrypted room name in `name_encrypted`. V2 replaces
-- it with an opaque encrypted JSON blob in `metadata` plus a monotonic
-- `metadata_version` counter for client cache invalidation.
--
-- V1 was never deployed. There is no data to preserve. The old column
-- is dropped without copying.

ALTER TABLE rooms ADD COLUMN metadata TEXT;
ALTER TABLE rooms ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms DROP COLUMN name_encrypted;
