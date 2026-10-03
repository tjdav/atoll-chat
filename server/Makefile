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
	@echo "  make test-sync         User-scoped sync foundation, sequence allocation, sync endpoint, channel auth"
	@echo "  make test-link-preview Link preview proxy, Content Key encryption, SSRF guard, size limits, and rate limiting"
	@echo "  make test-all          Run all batches sequentially"
	@echo "  make check-batches     Verify no orphan test files"
	@echo ""
	@echo "To run a single test:"
	@echo "  cargo test --test <file> <function_name> -- --nocapture"

.PHONY: test-identity
test-identity:
	$(CARGO) test --test gdpr --test gdpr_identity --test identity_schema --test key_transparency_log --test key_transparency_snapshots --test login_oprf --test lookup_oprf --test profile_oprf --test recovery_code --test recovery_endpoints --test register_oprf

.PHONY: test-auth
test-auth:
	$(CARGO) test --test admin --test altcha --test audit --test auth --test devices --test invites --test login --test permissions --test ready

.PHONY: test-messaging
test-messaging:
	$(CARGO) test --test key_packages --test message_deletion --test message_edit_events --test message_edit_validation --test message_edit_write --test message_sync --test moderation --test reaction_events --test reaction_list --test reaction_validation --test reaction_write --test retention_preview --test room_invites --test room_members_pagination --test room_messages --test room_metadata_events --test room_metadata_validation --test room_metadata_write --test rooms --test welcomes

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
	$(CARGO) test --test event_publishing --test pending_adds --test pending_removes --test sockudo

.PHONY: test-push
test-push:
	$(CARGO) test --test push_apns --test push_delivery --test push_delivery_native --test push_fcm --test push_payload --test push_subscriptions --test push_suppression --test push_vapid

.PHONY: test-sync
test-sync:
	$(CARGO) test --test device_name_login --test device_name_sync --test device_name_validation --test device_name_write --test preferences_crud --test preferences_sync --test preferences_validation --test read_state_sync --test read_state_write --test starred_items --test sync_channel_auth --test sync_endpoint --test sync_seq

.PHONY: test-link-preview
test-link-preview:
	$(CARGO) test --test link_preview

.PHONY: test-all
test-all: check-batches test-identity test-auth test-messaging test-storage test-oprf test-operations test-transport test-sockudo test-push test-sync test-link-preview
	@echo ""
	@echo "All batches passed."

.PHONY: check-batches
check-batches:
	@bash scripts/check-test-batches.sh
