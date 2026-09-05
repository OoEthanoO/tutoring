//! YanLearn Recorder — native shell.
//!
//! The recording state machine lives in the webview (src/main.js); this side
//! owns everything that needs the OS: spawning ffmpeg, capturing system audio,
//! the always-on-top status overlay, the global pause hotkey, the tray icon,
//! the quit lock, file storage, and the streaming upload.

mod capture;
mod overlay;
mod sysaudio;
mod update;
mod upload;
mod windowlist;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct AppState {
    /// While a class is armed/live/uploading the tutor may not quit.
    pub quit_locked: AtomicBool,
    pub capture: Mutex<Option<capture::CaptureSession>>,
    pub system_audio: Mutex<Option<sysaudio::SystemAudioFeeder>>,
    /// Last overlay state, replayed to the overlay window when it (re)loads.
    pub overlay: Mutex<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    platform: String,
    arch: String,
    host_name: String,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        host_name: std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_default(),
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = data_dir(&app)?.join("settings.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = data_dir(&app)?.join("settings.json");
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn recordings_dir(app: AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?.join("recordings");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        out.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if target.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else if target.exists() {
        std::fs::remove_file(target).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|meta| meta.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_quit_lock(state: tauri::State<'_, AppState>, locked: bool) {
    state.quit_locked.store(locked, Ordering::SeqCst);
}

#[tauri::command]
fn quit_app(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if state.quit_locked.load(Ordering::SeqCst) {
        return Err(
            "YanLearn Recorder cannot be closed until this class is finished and uploaded.".into(),
        );
    }
    stop_everything(&app);
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// Used after an automatic update: a recorder that was living in the tray
/// before it restarted itself goes back there instead of popping a window up.
#[tauri::command]
fn hide_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn main_window_visible(app: AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
fn register_hotkey(app: AppHandle, combo: String) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    shortcuts
        .register(combo.as_str())
        .map_err(|e| format!("Could not register the hotkey {combo}: {e}"))
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Stop ffmpeg and the system-audio feeder (used on every exit path).
pub(crate) fn stop_everything(app: &AppHandle) {
    let state = app.state::<AppState>();
    // Take both out from under their locks before stopping them: ffmpeg can take
    // seconds to exit, and holding a mutex across that would stall every other
    // caller. It also keeps the lock temporaries from outliving `state`.
    let session = state.capture.lock().ok().and_then(|mut guard| guard.take());
    let feeder = state.system_audio.lock().ok().and_then(|mut guard| guard.take());
    if let Some(mut session) = session {
        let _ = session.stop();
    }
    if let Some(mut feeder) = feeder {
        feeder.stop();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if matches!(event.state(), ShortcutState::Pressed) {
                        let _ = app.emit("hotkey", ());
                    }
                })
                .build(),
        )
        .manage(update::UpdateState::default())
        .manage(AppState {
            quit_locked: AtomicBool::new(false),
            capture: Mutex::new(None),
            system_audio: Mutex::new(None),
            overlay: Mutex::new(serde_json::Value::Null),
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            load_settings,
            save_settings,
            recordings_dir,
            list_dir,
            ensure_dir,
            read_text_file,
            write_text_file,
            remove_path,
            file_size,
            set_quit_lock,
            quit_app,
            show_main_window,
            hide_main_window,
            main_window_visible,
            register_hotkey,
            capture::probe_capture,
            capture::start_capture,
            capture::stop_capture,
            capture::capture_status,
            capture::concat_segments,
            capture::extract_last_frame,
            overlay::set_overlay,
            overlay::get_overlay_state,
            overlay::list_displays,
            overlay::identify_displays,
            windowlist::list_windows,
            windowlist::focused_window,
            upload::upload_file,
            update::check_update,
            update::download_update,
            update::install_update,
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open YanLearn Recorder", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("missing application icon")?;
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("YanLearn Recorder")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        let locked = app.state::<AppState>().quit_locked.load(Ordering::SeqCst);
                        if locked {
                            let _ = app.emit("quit-blocked", ());
                            show_main(app);
                        } else {
                            stop_everything(app);
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window never quits: the recorder keeps running in
                // the tray so it is open for the next class. Quit is in the tray
                // menu and refuses while a class is in progress.
                api.prevent_close();
                let _ = window.hide();
                let _ = window.emit("hidden-to-tray", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building YanLearn Recorder")
        .run(|app, event| match event {
            RunEvent::ExitRequested { code, api, .. } => {
                // `code` is Some when we called app.exit() ourselves; None means
                // the OS or the user (Cmd+Q) asked. Refuse the latter while locked.
                if code.is_none() && app.state::<AppState>().quit_locked.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("quit-blocked", ());
                    show_main(app);
                }
            }
            RunEvent::Exit => {
                stop_everything(app);
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                show_main(app);
            }
            _ => {}
        });
}
