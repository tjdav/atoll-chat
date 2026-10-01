#!/usr/bin/env bash
#
# Verifies that every file in server/tests/*.rs appears in exactly one
# batch in server/tests/batch-manifest.toml.
#
# Exits 0 if all files are accounted for.
# Exits 1 with a list of orphans if any file is missing or duplicated.

set -euo pipefail

cd "$(dirname "$0")/.."

MANIFEST="tests/batch-manifest.toml"

if [[ ! -f "$MANIFEST" ]]; then
    echo "ERROR: $MANIFEST not found"
    exit 1
fi

# Extract all file names from the manifest.
manifest_files=$(grep -oP '^\s*"\K[^"]+(?=",?)' "$MANIFEST" | sort)

# Extract all test file names from the directory.
# Exclude common helper modules that are not test binaries.
actual_files=$(ls tests/*.rs 2>/dev/null \
    | sed 's|.*/||;s|\.rs$||' \
    | grep -v '^common$' \
    | grep -v '^test_batch_manifest$' \
    | sort)

# Files in the directory but not in the manifest.
orphans=$(comm -23 <(echo "$actual_files") <(echo "$manifest_files"))

# Files in the manifest but not in the directory.
phantom=$(comm -13 <(echo "$actual_files") <(echo "$manifest_files"))

# Files listed twice in the manifest.
duplicates=$(echo "$manifest_files" | uniq -d)

status=0

if [[ -n "$orphans" ]]; then
    echo "FAIL: test files not assigned to any batch:"
    echo "$orphans" | sed 's/^/  /'
    status=1
fi

if [[ -n "$phantom" ]]; then
    echo "FAIL: manifest references files that do not exist:"
    echo "$phantom" | sed 's/^/  /'
    status=1
fi

if [[ -n "$duplicates" ]]; then
    echo "FAIL: files assigned to more than one batch:"
    echo "$duplicates" | sed 's/^/  /'
    status=1
fi

if [[ $status -eq 0 ]]; then
    echo "OK: all test files assigned to exactly one batch"
fi

exit $status
