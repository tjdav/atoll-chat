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

This system uses a role-based access control (RBAC) model. The following global roles are pre-seeded:

- **owner**: Has full access to everything. Granted the `*` wildcard permission.
- **admin**: Can manage users, instance config, rooms, backups, and generate unlimited invites.
- **inviter**: Can generate limited invites.
- **member**: Basic role allowing room creation, joining, and messaging.

### Wildcard Permission
The `*` permission satisfies any permission check. The `owner` role uses this to ensure it always has access, even to new permissions added in the future.

### Bootstrap Behavior
The server checks the number of users on startup. If no users exist, it logs that the first registration will become the owner. If users exist, it assumes the owner role is already assigned.

### Endpoints
- `GET /api/v1/roles` - Returns the four global roles ordered by descending level. (Unauthenticated)

### Testing
You can run the unit and integration tests using:

```bash
cargo test
```
