-- Migration 0013: KeyPackage schema update and indexes for claim ordering
ALTER TABLE key_packages RENAME COLUMN key_package TO key_package_data;
ALTER TABLE key_packages ADD COLUMN cipher_suite INTEGER NOT NULL DEFAULT 1;
ALTER TABLE key_packages ADD COLUMN is_last_resort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE key_packages ADD COLUMN consumed_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_kp_claim_order
    ON key_packages(user_id, consumed, is_last_resort, created_at ASC, id ASC)
    WHERE consumed = 0;
