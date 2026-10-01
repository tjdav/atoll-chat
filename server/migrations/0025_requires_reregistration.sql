-- V2 Amendment 13 follow-up: reregistration flag.
--
-- After the username OPRF key is rotated, every stored username_token
-- becomes invalid. Users are flagged for re-registration. The login
-- handler rejects flagged users with HTTP 409.

ALTER TABLE users ADD COLUMN requires_reregistration INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_requires_reregistration
    ON users(requires_reregistration)
    WHERE requires_reregistration = 1;
