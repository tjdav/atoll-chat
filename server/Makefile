# Test targets. Each target runs one domain batch.
# Batches are defined in tests/batch-manifest.toml.

CARGO ?= cargo

.PHONY: help
help:
	@echo "Test targets:"
	@echo "  make test-identity     OPRF identity flows, registration, login, lookup, profile, GDPR"
	@echo "  make test-auth         Sessions, devices, admin config, ALTCHA, login, permissions, invites, audit, ready"
	@echo "  make test-messaging    Rooms, messages, welcomes, key packages, moderation, room invites, message deletion, message sync"
	@echo "  make test-storage      Attachments, backups, retention, storage migration"
	@echo "  make test-oprf         OPRF endpoint and keys"
	@echo "  make test-operations   CLI, rotation, cleanup"
	@echo "  make test-transport    HTTPS, SPA"
	@echo "  make test-sockudo      Sockudo, events, pending removes"
	@echo "  make test-push         Push subscriptions, Web Push, VAPID, delivery, APNs, FCM"
	@echo "  make test-all          Run all batches sequentially"
	@echo "  make check-batches     Verify no orphan test files"
	@echo ""
	@echo "To run a single test:"
	@echo "  cargo test --test <file> <function_name> -- --nocapture"

.PHONY: test-identity
test-identity:
	$(CARGO) test --test gdpr --test gdpr_identity --test identity_schema --test login_oprf --test lookup_oprf --test profile_oprf --test register_oprf --test registration

.PHONY: test-auth
test-auth:
	$(CARGO) test --test admin --test altcha --test audit --test auth --test devices --test invites --test login --test permissions --test ready

.PHONY: test-messaging
test-messaging:
	$(CARGO) test --test key_packages --test message_deletion --test message_sync --test moderation --test room_invites --test room_messages --test rooms --test welcomes

.PHONY: test-storage
test-storage:
	$(CARGO) test --test admin_backups --test attachment_retention --test attachments --test attachments_presign --test attachments_range --test backup --test backup_restore --test cli_storage_migrate --test storage --test storage_migrate

.PHONY: test-oprf
test-oprf:
	$(CARGO) test --test oprf_blind --test oprf_keys

.PHONY: test-operations
test-operations:
	$(CARGO) test --test admin_rotate --test cleanup --test cli_migrate --test cli_rotate

.PHONY: test-transport
test-transport:
	$(CARGO) test --test static --test transport

.PHONY: test-sockudo
test-sockudo:
	$(CARGO) test --test event_publishing --test pending_removes --test sockudo

.PHONY: test-push
test-push:
	$(CARGO) test --test push_apns --test push_delivery --test push_delivery_native --test push_fcm --test push_payload --test push_subscriptions --test push_suppression --test push_vapid

.PHONY: test-all
test-all: check-batches test-identity test-auth test-messaging test-storage test-oprf test-operations test-transport test-sockudo test-push
	@echo ""
	@echo "All batches passed."

.PHONY: check-batches
check-batches:
	@bash scripts/check-test-batches.sh
