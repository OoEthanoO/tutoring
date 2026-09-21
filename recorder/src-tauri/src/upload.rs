//! Streaming upload of the finished recording to the signed storage URL.
//! The file is streamed from disk in 256 KB chunks — never loaded into memory —
//! and progress is emitted to the UI as `upload-progress`.

use std::time::Duration;
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio_util::io::ReaderStream;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    path: String,
    url: String,
    content_type: String,
) -> Result<UploadResult, String> {
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("Could not open {path}: {e}"))?;
    let total = file
        .metadata()
        .await
        .map_err(|e| e.to_string())?
        .len();

    let mut sent: u64 = 0;
    let started = std::time::Instant::now();
    let last_progress = Arc::new(AtomicU64::new(0));
    let stream_progress = last_progress.clone();
    let mut last_emitted: u64 = 0;
    let step = (total / 100).max(256 * 1024);
    let progress_app = app.clone();
    let stream = ReaderStream::with_capacity(file, 256 * 1024).map(move |chunk| {
        if let Ok(bytes) = &chunk {
            stream_progress.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            sent += bytes.len() as u64;
            if sent - last_emitted >= step || sent == total {
                last_emitted = sent;
                let _ = progress_app.emit(
                    "upload-progress",
                    serde_json::json!({ "sent": sent, "total": total }),
                );
            }
        }
        chunk
    });

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(6 * 60 * 60))
        .build()
        .map_err(|e| e.to_string())?;
    let request = async {
    let response = client
        .put(&url)
        .header("Content-Type", content_type)
        .header("Content-Length", total.to_string())
        .header("x-upsert", "true")
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e.without_url()))?;
    let status = response.status().as_u16();
    let body: String = response
        .text()
        .await
        .map_err(|e| format!("Upload response failed: {}", e.without_url()))?
        .chars()
        .take(500)
        .collect();
    Ok(UploadResult { status, body })
    };
    // Keep slow-but-moving uploads alive. Cancel a stalled connection instead
    // of waiting out the six-hour overall timeout; JS retains the file/retries.
    with_idle_timeout(request, started, last_progress, Duration::from_secs(120)).await
}

async fn with_idle_timeout<T>(
    request: impl std::future::Future<Output = Result<T, String>>,
    started: std::time::Instant,
    last_progress: Arc<AtomicU64>,
    timeout: Duration,
) -> Result<T, String> {
    tokio::pin!(request);
    let mut check = tokio::time::interval(timeout / 2);
    loop {
        tokio::select! {
            result = &mut request => return result,
            _ = check.tick() => {
                let idle = (started.elapsed().as_millis() as u64)
                    .saturating_sub(last_progress.load(Ordering::Relaxed));
                if idle >= timeout.as_millis() as u64 {
                    return Err("Upload stalled without progress. The recording is saved and will be retried.".into());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancels_a_stalled_transfer() {
        let result = with_idle_timeout(std::future::pending::<Result<(), String>>(),
            std::time::Instant::now(), Arc::new(AtomicU64::new(0)), Duration::from_millis(20)).await;
        assert!(result.unwrap_err().contains("stalled"));
    }

    #[tokio::test]
    async fn allows_a_slow_transfer_that_keeps_making_progress() {
        let started = std::time::Instant::now();
        let progress = Arc::new(AtomicU64::new(0));
        let update = progress.clone();
        let transfer = async move {
            for _ in 0..8 {
                tokio::time::sleep(Duration::from_millis(10)).await;
                update.store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
            }
            Ok(())
        };
        assert!(with_idle_timeout(transfer, started, progress, Duration::from_millis(50)).await.is_ok());
    }
}
