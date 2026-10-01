-- V2 Amendment 15: user-scoped sync sequence counter.
--
-- Every user has a monotonic counter that allocates user_seq values to
-- user-scoped state rows. The counter is per-user so that a user's
-- devices converge on a total order without cross-user coordination.

CREATE TABLE user_seq (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_seq    INTEGER NOT NULL DEFAULT 1
);
