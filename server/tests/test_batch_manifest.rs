//! Verifies that every test file in tests/ is assigned to exactly one batch.
//!
//! This test reads the directory listing and the manifest, and asserts
//! they are consistent. It catches the common mistake of adding a new
//! test file without registering it in the manifest.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[test]
fn every_test_file_is_in_exactly_one_batch() {
    let tests_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let manifest_path = tests_dir.join("batch-manifest.toml");

    // Parse the manifest.
    let manifest_content = fs::read_to_string(&manifest_path).expect("read batch-manifest.toml");
    let manifest: toml::Value =
        toml::from_str(&manifest_content).expect("parse batch-manifest.toml");

    let mut manifest_files: HashMap<String, Vec<String>> = HashMap::new();
    let batches = manifest
        .get("batch")
        .and_then(|v| v.as_array())
        .expect("batch array");

    for batch in batches {
        let batch_name = batch
            .get("name")
            .and_then(|v| v.as_str())
            .expect("batch.name");
        let files = batch
            .get("files")
            .and_then(|v| v.as_array())
            .expect("batch.files");

        for file in files {
            let file_name = file.as_str().expect("file name").to_string();
            manifest_files
                .entry(file_name)
                .or_default()
                .push(batch_name.to_string());
        }
    }

    // Enumerate actual test files.
    let mut actual_files = HashSet::new();
    for entry in fs::read_dir(&tests_dir).expect("read tests dir") {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("file stem");
        // Exclude helper modules.
        if name == "common" || name == "test_batch_manifest" {
            continue;
        }
        actual_files.insert(name.to_string());
    }

    // Assert every actual file is in the manifest.
    let manifest_set: HashSet<_> = manifest_files.keys().cloned().collect();

    let orphans: Vec<_> = actual_files.difference(&manifest_set).collect();
    assert!(
        orphans.is_empty(),
        "test files not assigned to any batch: {:?}",
        orphans
    );

    let phantoms: Vec<_> = manifest_set.difference(&actual_files).collect();
    assert!(
        phantoms.is_empty(),
        "manifest references non-existent files: {:?}",
        phantoms
    );

    // Assert no file is in two batches.
    let duplicates: Vec<_> = manifest_files
        .iter()
        .filter(|(_, v)| v.len() > 1)
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    assert!(
        duplicates.is_empty(),
        "files assigned to multiple batches: {:?}",
        duplicates
    );
}
