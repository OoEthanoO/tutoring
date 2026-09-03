//! Streaming upload of the finished recording to the signed storage URL.
//! The file is streamed from disk in 256 KB chunks — never loaded into memory —
//! and progress is emitted to the UI as `upload-progress`.

use std::time::Duration;

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
    let mut last_emitted: u64 = 0;
    let step = (total / 100).max(256 * 1024);
    let progress_app = app.clone();
    let stream = ReaderStream::with_capacity(file, 256 * 1024).map(move |chunk| {
        if let Ok(bytes) = &chunk {
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
        .timeout(Duration::from_secs(6 * 60 * 60))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .put(&url)
        .header("Content-Type", content_type)
        .header("Content-Length", total.to_string())
        .header("x-upsert", "true")
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;
    let status = response.status().as_u16();
    let body: String = response
        .text()
        .await
        .unwrap_or_default()
        .chars()
        .take(500)
        .collect();
    Ok(UploadResult { status, body })
}
