use crate::config::Config;
use crate::models::manifest::{load_manifest, ModelManifest};
use crate::models::verify::verify_file_content;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use url::Url;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Serialize)]
pub struct FetchFileResult {
    pub kind: String,
    pub path: String,
    pub status: String, // "downloaded", "already_present", "download_failed", "size_mismatch", "hash_mismatch"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256_ok: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct FetchSummary {
    pub total_files: usize,
    pub downloaded: usize,
    pub already_present: usize,
    pub failed: usize,
}

#[derive(Debug, Serialize)]
pub struct FetchOutput {
    pub from: String,
    pub kind: String,
    pub files: Vec<FetchFileResult>,
    pub summary: FetchSummary,
    pub ok: bool,
}

struct DownloadTarget {
    kind: String,
    model_id: String,
    version: u32,
    filename: String,
    size_bytes: u64,
    sha256: String,
    dest_path: PathBuf,
    rel_path_str: String,
}

pub async fn run_models_fetch(
    from_url: &str,
    kind_arg: &str,
    json: bool,
    jobs: usize,
    force: bool,
) -> Result<i32, Box<dyn std::error::Error>> {
    let normalized_kind = kind_arg.to_lowercase();
    if normalized_kind != "stt" && normalized_kind != "tts" && normalized_kind != "all" {
        eprintln!(
            "ERROR: invalid --kind '{}' (must be 'stt', 'tts', or 'all')",
            kind_arg
        );
        return Ok(2);
    }

    if !(1..=8).contains(&jobs) {
        eprintln!("ERROR: invalid --jobs {} (must be between 1 and 8)", jobs);
        return Ok(2);
    }

    let config = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("ERROR: failed to load configuration: {}", e);
            return Ok(2);
        }
    };

    let parsed_url = match Url::parse(from_url) {
        Ok(u) => u,
        Err(e) => {
            eprintln!("ERROR: invalid --from URL '{}': {}", from_url, e);
            return Ok(2);
        }
    };

    if config.app_env == "production" && parsed_url.scheme() != "https" {
        eprintln!(
            "ERROR: --from URL must use https in production mode (got {})",
            parsed_url.scheme()
        );
        return Ok(2);
    }

    let url_path = parsed_url.path();
    if url_path.contains("/stt/v1/") || url_path.contains("/tts/v1/") {
        eprintln!(
            "ERROR: --from URL must be origin base, not kind root (contains /stt/v1/ or /tts/v1/)"
        );
        return Ok(2);
    }

    let base_url_str = from_url.trim_end_matches('/').to_string();

    let mut kinds_to_fetch = Vec::new();
    if normalized_kind == "all" || normalized_kind == "stt" {
        kinds_to_fetch.push(("stt", &config.stt_models_path));
    }
    if normalized_kind == "all" || normalized_kind == "tts" {
        kinds_to_fetch.push(("tts", &config.tts_models_path));
    }

    let mut targets = Vec::new();

    for (kind, base_path) in kinds_to_fetch {
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
            let model_dir = base_path.join(&model.id).join(model.version.to_string());
            for file_entry in &model.files {
                let dest_path = model_dir.join(&file_entry.name);
                let rel_path_str = format!("{}/{}/{}", model.id, model.version, file_entry.name);
                targets.push(DownloadTarget {
                    kind: kind.to_string(),
                    model_id: model.id.clone(),
                    version: model.version,
                    filename: file_entry.name.clone(),
                    size_bytes: file_entry.size_bytes,
                    sha256: file_entry.sha256.clone(),
                    dest_path,
                    rel_path_str,
                });
            }
        }
    }

    let http_client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(READ_TIMEOUT)
        .build()?;

    // Test connectivity on first target if targets exist
    if let Some(first) = targets.first() {
        let test_url = format!(
            "{}/{}/v1/{}/{}/{}",
            base_url_str, first.kind, first.model_id, first.version, first.filename
        );
        let res = http_client.head(&test_url).send().await;
        if let Err(e) = res {
            if e.is_connect() || e.is_builder() {
                eprintln!("ERROR: unreachable base URL '{}': {}", base_url_str, e);
                return Ok(2);
            }
        }
    }

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(jobs));
    let mut tasks = Vec::new();

    for target in targets {
        let sem = semaphore.clone();
        let client = http_client.clone();
        let base_url = base_url_str.clone();

        tasks.push(tokio::spawn(async move {
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => {
                    return FetchFileResult {
                        kind: target.kind,
                        path: target.rel_path_str,
                        status: "download_failed".to_string(),
                        size_bytes: None,
                        sha256_ok: None,
                    };
                }
            };

            if !force {
                let (actual_size, _actual_sha, status) =
                    verify_file_content(&target.dest_path, target.size_bytes, &target.sha256);
                if status == "ok" {
                    return FetchFileResult {
                        kind: target.kind,
                        path: target.rel_path_str,
                        status: "already_present".to_string(),
                        size_bytes: actual_size,
                        sha256_ok: Some(true),
                    };
                }
            }

            if let Some(parent) = target.dest_path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }

            let file_url = format!(
                "{}/{}/v1/{}/{}/{}",
                base_url, target.kind, target.model_id, target.version, target.filename
            );

            let temp_filename = format!(
                "{}.tmp.{}.{}",
                target.filename,
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            let temp_path = match target.dest_path.parent() {
                Some(parent) => parent.join(&temp_filename),
                None => target.dest_path.with_file_name(&temp_filename),
            };

            let outcome = download_file(
                &client,
                &file_url,
                &temp_path,
                target.size_bytes,
                &target.sha256,
            )
            .await;

            match outcome {
                Ok(()) => {
                    if tokio::fs::rename(&temp_path, &target.dest_path)
                        .await
                        .is_err()
                    {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        FetchFileResult {
                            kind: target.kind,
                            path: target.rel_path_str,
                            status: "download_failed".to_string(),
                            size_bytes: None,
                            sha256_ok: None,
                        }
                    } else {
                        FetchFileResult {
                            kind: target.kind,
                            path: target.rel_path_str,
                            status: "downloaded".to_string(),
                            size_bytes: Some(target.size_bytes),
                            sha256_ok: Some(true),
                        }
                    }
                }
                Err(status_err) => {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    FetchFileResult {
                        kind: target.kind,
                        path: target.rel_path_str,
                        status: status_err,
                        size_bytes: None,
                        sha256_ok: None,
                    }
                }
            }
        }));
    }

    let mut results = Vec::new();
    for task in tasks {
        results.push(task.await?);
    }

    let mut downloaded = 0;
    let mut already_present = 0;
    let mut failed = 0;

    for r in &results {
        match r.status.as_str() {
            "downloaded" => downloaded += 1,
            "already_present" => already_present += 1,
            _ => failed += 1,
        }
    }

    let total_files = results.len();
    let ok = failed == 0;

    if json {
        let output = FetchOutput {
            from: base_url_str,
            kind: normalized_kind,
            files: results,
            summary: FetchSummary {
                total_files,
                downloaded,
                already_present,
                failed,
            },
            ok,
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        for r in &results {
            let full_path_display = format!("{}/{}", r.kind, r.path);
            match r.status.as_str() {
                "downloaded" => {
                    let size = r.size_bytes.unwrap_or(0);
                    println!("{:<40} downloaded  {} bytes  OK", full_path_display, size);
                }
                "already_present" => {
                    println!(
                        "{:<40} already present                 OK",
                        full_path_display
                    );
                }
                "size_mismatch" => {
                    println!("{:<40} FAIL (size mismatch)", full_path_display);
                }
                "hash_mismatch" => {
                    println!("{:<40} FAIL (hash mismatch)", full_path_display);
                }
                _ => {
                    println!("{:<40} FAIL", full_path_display);
                }
            }
        }

        println!();
        if ok {
            println!(
                "Fetched {} files, skipped {}, verified all.",
                downloaded, already_present
            );
            println!("Exit code 0.");
        } else {
            println!(
                "Fetched {} files, skipped {}, {} failed.",
                downloaded, already_present, failed
            );
            println!("Exit code 1.");
        }
    }

    if ok {
        Ok(0)
    } else {
        Ok(1)
    }
}

async fn download_file(
    client: &reqwest::Client,
    url: &str,
    temp_path: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), String> {
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|_| "download_failed".to_string())?;

    if !res.status().is_success() {
        return Err("download_failed".to_string());
    }

    let mut file = tokio::fs::File::create(temp_path)
        .await
        .map_err(|_| "download_failed".to_string())?;

    let mut hasher = Sha256::new();
    let mut total_bytes: u64 = 0;

    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|_| "download_failed".to_string())?
    {
        total_bytes += chunk.len() as u64;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|_| "download_failed".to_string())?;
    }

    file.flush()
        .await
        .map_err(|_| "download_failed".to_string())?;
    drop(file);

    if total_bytes != expected_size {
        return Err("size_mismatch".to_string());
    }

    let actual_sha256 = format!("{:x}", hasher.finalize()).to_lowercase();
    if actual_sha256 != expected_sha256.to_lowercase() {
        return Err("hash_mismatch".to_string());
    }

    Ok(())
}
