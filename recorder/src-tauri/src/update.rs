//! Automatic updates.
//!
//! The recorder checks a signed manifest published with every GitHub release
//! and installs new versions by itself. *When* that happens is decided in the
//! webview (src/main.js), because only it knows whether this is a safe moment:
//! the app must never restart while a class is armed, recording, or uploading.
//!
//! Downloading and installing are separate commands on purpose. The download
//! runs in the background and may take as long as the network needs; the
//! webview re-checks that nothing has come up before it asks for the install,
//! which is the only step that costs the process.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// What the last `check_update` found, and its bytes once downloaded.
#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
}

impl UpdateState {
    fn pending(&self) -> Result<Option<Update>, String> {
        Ok(self.pending.lock().map_err(poisoned)?.clone())
    }
}

fn poisoned<E>(_: E) -> String {
    "The updater is in a bad state; restart the recorder.".to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

/// Ask the update server whether there is a newer version. `None` means the
/// recorder is up to date.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|err| err.to_string())?;
    let found = updater.check().await.map_err(|err| err.to_string())?;
    let info = found.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    });

    let state = app.state::<UpdateState>();
    *state.pending.lock().map_err(poisoned)? = found;
    // Anything already downloaded belongs to the previous answer.
    *state.downloaded.lock().map_err(poisoned)? = None;
    Ok(info)
}

/// Download and verify the update found by `check_update`, keeping the bytes
/// in memory until `install_update` is asked for. Safe to run at any time: it
/// touches nothing but the network.
#[tauri::command]
pub async fn download_update(app: AppHandle) -> Result<(), String> {
    let Some(update) = app.state::<UpdateState>().pending()? else {
        return Err("No update has been found to download.".into());
    };

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|err| err.to_string())?;

    *app.state::<UpdateState>()
        .downloaded
        .lock()
        .map_err(poisoned)? = Some(bytes);
    Ok(())
}

/// Install what `download_update` fetched, and restart into it.
///
/// This does not come back: either the installer ends this process (Windows) or
/// we relaunch ourselves (macOS). The caller is responsible for only asking at
/// a moment when losing the process costs nothing.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app.state::<UpdateState>().pending()?;
    let bytes = app
        .state::<UpdateState>()
        .downloaded
        .lock()
        .map_err(poisoned)?
        .take();
    let (Some(update), Some(bytes)) = (update, bytes) else {
        return Err("No update has been downloaded yet.".into());
    };

    // There should be nothing running when we update, but the Windows installer
    // ends this process without warning: make sure no ffmpeg child outlives us.
    crate::stop_everything(&app);

    update.install(bytes).map_err(|err| err.to_string())?;

    // Windows never reaches this: the installer has already relaunched the app.
    app.restart();
}
