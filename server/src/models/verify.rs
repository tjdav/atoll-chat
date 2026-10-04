use crate::config::Config;
use crate::models::manifest::{load_manifest, ModelManifest};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct VerifyFileResult {
    pub name: String,
    pub expected_size: u64,
    pub actual_size: Option<u64>,
    pub expected_sha256: String,
    pub actual_sha256: Option<String>,
    pub status: String, // "ok", "missing", "size_mismatch", "hash_mismatch"
}

#[derive(Debug, Serialize)]
pub struct VerifyModelResult {
    pub kind: String,
    pub id: String,
    pub version: u32,
    pub files: Vec<VerifyFileResult>,
}

#[derive(Debug, Serialize)]
pub struct VerifySummary {
    pub total_files: usize,
    pub verified: usize,
    pub failed: usize,
    pub missing: usize,
}

#[derive(Debug, Serialize)]
pub struct VerifyOutput {
    pub kind: String,
    pub models: Vec<VerifyModelResult>,
    pub summary: VerifySummary,
    pub ok: bool,
}

pub fn verify_file_content(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> (Option<u64>, Option<String>, String) {
    if !path.exists() {
        return (None, None, "missing".to_string());
    }

    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return (None, None, "missing".to_string()),
    };

    let actual_size = meta.len();
    if actual_size != expected_size {
        return (Some(actual_size), None, "size_mismatch".to_string());
    }

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return (Some(actual_size), None, "missing".to_string()),
    };

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            Err(_) => return (Some(actual_size), None, "missing".to_string()),
        }
    }

    let actual_sha256 = format!("{:x}", hasher.finalize()).to_lowercase();
    if actual_sha256 != expected_sha256.to_lowercase() {
        return (
            Some(actual_size),
            Some(actual_sha256),
            "hash_mismatch".to_string(),
        );
    }

    (Some(actual_size), Some(actual_sha256), "ok".to_string())
}

pub fn run_models_verify(
    json: bool,
    kind_arg: &str,
    quiet: bool,
) -> Result<i32, Box<dyn std::error::Error>> {
    let normalized_kind = kind_arg.to_lowercase();
    if normalized_kind != "stt" && normalized_kind != "tts" && normalized_kind != "all" {
        eprintln!(
            "ERROR: invalid --kind '{}' (must be 'stt', 'tts', or 'all')",
            kind_arg
        );
        return Ok(2);
    }

    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("ERROR: failed to load configuration: {}", e);
            return Ok(2);
        }
    };

    let mut kinds_to_verify = Vec::new();
    if normalized_kind == "all" || normalized_kind == "stt" {
        kinds_to_verify.push(("stt", &config.stt_models_path));
    }
    if normalized_kind == "all" || normalized_kind == "tts" {
        kinds_to_verify.push(("tts", &config.tts_models_path));
    }

    let mut verified_models = Vec::new();
    let mut total_files = 0;
    let mut verified_count = 0;
    let mut failed_count = 0;
    let mut missing_count = 0;

    for (kind, base_path) in kinds_to_verify {
        let manifest_path = base_path.join("manifest.json");
        let manifest: ModelManifest = match load_manifest(&manifest_path) {
            Ok(m) => m,
            Err(e) => {
                eprintln!(
                    "ERROR: failed to load manifest for {} at {:?}: {}",
                    kind, manifest_path, e
                );
                return Ok(2);
            }
        };

        for model in &manifest.models {
            let mut file_results = Vec::new();
            let model_dir = base_path.join(&model.id).join(model.version.to_string());

            for file_entry in &model.files {
                total_files += 1;
                let file_path = model_dir.join(&file_entry.name);
                let (actual_size, actual_sha256, status) =
                    verify_file_content(&file_path, file_entry.size_bytes, &file_entry.sha256);

                match status.as_str() {
                    "ok" => verified_count += 1,
                    "missing" => {
                        missing_count += 1;
                        failed_count += 1;
                    }
                    _ => failed_count += 1,
                }

                file_results.push(VerifyFileResult {
                    name: file_entry.name.clone(),
                    expected_size: file_entry.size_bytes,
                    actual_size,
                    expected_sha256: file_entry.sha256.clone(),
                    actual_sha256,
                    status,
                });
            }

            verified_models.push(VerifyModelResult {
                kind: kind.to_string(),
                id: model.id.clone(),
                version: model.version,
                files: file_results,
            });
        }
    }

    let ok = failed_count == 0;

    if json {
        let output = VerifyOutput {
            kind: normalized_kind,
            models: verified_models,
            summary: VerifySummary {
                total_files,
                verified: verified_count,
                failed: failed_count,
                missing: missing_count,
            },
            ok,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        if !quiet {
            let mut current_kind = "";
            for model_res in &verified_models {
                if model_res.kind != current_kind {
                    current_kind = &model_res.kind;
                    println!("{}", current_kind);
                }
                println!("  {} v{}", model_res.id, model_res.version);
                for file_res in &model_res.files {
                    match file_res.status.as_str() {
                        "ok" => {
                            println!(
                                "    {:<16} {} bytes      sha256 OK",
                                file_res.name, file_res.expected_size
                            );
                        }
                        "missing" => {
                            println!("    {:<16} missing  FAIL", file_res.name);
                        }
                        "size_mismatch" => {
                            let got = file_res.actual_size.unwrap_or(0);
                            println!(
                                "    {:<16} expected {} bytes, got {} bytes  FAIL",
                                file_res.name, file_res.expected_size, got
                            );
                        }
                        "hash_mismatch" => {
                            let expected_short = if file_res.expected_sha256.len() >= 8 {
                                &file_res.expected_sha256[..8]
                            } else {
                                &file_res.expected_sha256
                            };
                            let actual = file_res.actual_sha256.as_deref().unwrap_or("unknown");
                            let actual_short = if actual.len() >= 8 {
                                &actual[..8]
                            } else {
                                actual
                            };
                            println!(
                                "    {:<16} expected sha256 {}..., got {}...  FAIL",
                                file_res.name, expected_short, actual_short
                            );
                        }
                        _ => {
                            println!("    {:<16} FAIL", file_res.name);
                        }
                    }
                }
            }
            if !verified_models.is_empty() {
                println!();
            }
        }

        let model_count: usize = verified_models.len();
        if ok {
            println!(
                "Verified {} files across {} models.",
                total_files, model_count
            );
            println!("All files match the manifest.");
        } else {
            let fail_msg = if failed_count == 1 { "file" } else { "files" };
            println!("{} {} failed verification.", failed_count, fail_msg);
            println!("Exit code 1.");
        }
    }

    if ok {
        Ok(0)
    } else {
        Ok(1)
    }
}
