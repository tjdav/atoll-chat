# Testing Guide

## Why batched tests

The test suite has ~55 integration test binaries. Running `cargo test`
unfiltered exceeds common tool execution timeouts (540s in CI sandboxes).
Cargo runs test binaries sequentially, and each binary has non-trivial
setup cost (SQLite init, migrations, cryptographic key generation).

The solution is to run tests in domain batches. Each batch runs in
30–60 seconds and covers a coherent slice of the codebase.

## Running tests

    # Run a single batch
    make test-identity
    make test-auth
    make test-messaging
    make test-storage
    make test-oprf
    make test-operations
    make test-transport
    make test-sockudo
    make test-push

    # Run all batches sequentially
    make test-all

## Running a single test

    cargo test --test <file> <function> -- --nocapture

For example:

    cargo test --test register_oprf duplicate_token_returns_409 -- --nocapture

## Adding a new test file

1. Create `server/tests/<name>.rs`.
2. Add `<name>` to the `files` array of the appropriate batch in
   `server/tests/batch-manifest.toml`.
3. If no batch fits, add a new `[[batch]]` entry.
4. Update `server/Makefile` to include the new file in the target
   for the batch (or add a new target for a new batch).
5. Run `make check-batches` to verify no orphan files.

## The orphan check

`make check-batches` verifies that every file in `server/tests/*.rs`
appears in exactly one batch. It fails on:

- Files not assigned to any batch.
- Batches referencing files that do not exist.
- Files assigned to more than one batch.

Run it before committing any change that touches `server/tests/`.

The same invariant is enforced by the test in
`server/tests/test_batch_manifest.rs`. `cargo test --test test_batch_manifest`
runs it directly.

## Pre-commit checklist

    cargo fmt --check
    cargo clippy --all-targets -- -D warnings
    make check-batches
    make test-all

## On the 540-second tool timeout

If you are running tests from an automated tool that has a per-command
timeout, use the batch targets. Never run `cargo test` unfiltered.

If you add a new test binary and the batch containing it exceeds its
timeout budget (60s), move some tests to a new batch rather than raising
the budget.
