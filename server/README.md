# Encrypted Chat Server (Phase 1)

This is the foundation for a self-hosted, end-to-end encrypted group messaging system.

## Prerequisites

- Rust 1.85+
- cargo

## Build

```bash
cargo build --release
```

## Run in Development

```bash
cp .env.example .env
cargo run
```

Migrations will run automatically on startup. The SQLite database will be created at the path specified by `DB_PATH` in your `.env` file (by default, `./data/app.db`).

## Testing Endpoints

Check the health of the server:
```bash
curl http://localhost:8080/health
```

View server capabilities:
```bash
curl http://localhost:8080/api/v1/capabilities
```

## Verify Database

You can verify the created SQLite database using:
```bash
sqlite3 data/app.db ".tables"
```

## Roles and Permissions

This project implements a role-based access control (RBAC) system. There are four canonical roles:

- `owner` (Level 100)
- `admin` (Level 80)
- `inviter` (Level 50)
- `member` (Level 10)

### Permissions by Role

*   **Owner**: `Wildcard` (implies any permission).
*   **Admin**: `user.manage`, `invite.unlimited`, `config.edit`, `room.force_delete`, `backup.manage`.
*   **Inviter**: `invite.limited`.
*   **Member**: `room.create`, `room.join`, `message.send`.

When a permission check is performed, the user's role(s) are evaluated. If any role has the requested permission, or if any role has the `Wildcard` permission, the check returns true.

### Initialization

Role seeding (`seed_roles`) is run automatically on startup and is idempotent. This ensures that the roles exist in the database without throwing errors or duplicating rows on subsequent server starts.

Note: No HTTP routes currently use permissions yet. Phase 4 wires this authorization check in.
