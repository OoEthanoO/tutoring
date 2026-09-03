//! The always-on-top status overlay and the "identify displays" flash.
//!
//! The overlay is a small transparent, click-through, content-protected window
//! (so it never shows up in a Discord screen share or in the recording itself
//! on Windows). It normally sits in the bottom-right corner of the recorded
//! display as a pill; when the tutor pauses while still in the call it grows
//! into a centred banner that is hard to ignore.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

const OVERLAY_LABEL: &str = "overlay";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f64,
    pub primary: bool,
}

fn describe(index: usize, monitor: &Monitor, primary: bool) -> DisplayInfo {
    let size = monitor.size();
    let position = monitor.position();
    let name = monitor
        .name()
        .map(|name| name.to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| format!("Display {}", index + 1));
    DisplayInfo {
        index,
        name,
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        scale_factor: monitor.scale_factor(),
        primary,
    }
}

#[tauri::command]
pub fn list_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let primary_position = primary.as_ref().map(|monitor| *monitor.position());
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let is_primary = primary_position
                .map(|position| position == *monitor.position())
                .unwrap_or(index == 0);
            describe(index, monitor, is_primary)
        })
        .collect())
}

fn monitor_for(app: &AppHandle, display_index: Option<usize>) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if let Some(index) = display_index {
        if let Some(monitor) = monitors.get(index) {
            return Some(monitor.clone());
        }
    }
    app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())
}

fn make_overlay_window(
    app: &AppHandle,
    label: &str,
    url: &str,
    width: f64,
    height: f64,
) -> Result<tauri::WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("YanLearn Recorder status")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .content_protected(true)
        .visible_on_all_workspaces(true)
        .inner_size(width, height)
        .build()
        .map_err(|e| e.to_string())?;
    // Click-through: the overlay must never get in the way of the lesson.
    window.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    Ok(window)
}

/// `state`: { mode, title, detail, blocking, displayIndex }. mode "hidden" hides it.
#[tauri::command]
pub fn set_overlay(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    if let Ok(mut last) = app_state.overlay.lock() {
        *last = state.clone();
    }

    let mode = state.get("mode").and_then(|v| v.as_str()).unwrap_or("hidden");
    if mode == "hidden" {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            window.hide().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    let blocking = state.get("blocking").and_then(|v| v.as_bool()).unwrap_or(false);
    let display_index = state
        .get("displayIndex")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);
    let (width, height) = if blocking { (560.0, 150.0) } else { (360.0, 56.0) };

    let window = match app.get_webview_window(OVERLAY_LABEL) {
        Some(window) => window,
        None => make_overlay_window(&app, OVERLAY_LABEL, "overlay.html", width, height)?,
    };

    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    if let Some(monitor) = monitor_for(&app, display_index) {
        let scale = monitor.scale_factor().max(0.5);
        let monitor_width = monitor.size().width as f64 / scale;
        let monitor_height = monitor.size().height as f64 / scale;
        let origin_x = monitor.position().x as f64 / scale;
        let origin_y = monitor.position().y as f64 / scale;
        let (x, y) = if blocking {
            (origin_x + (monitor_width - width) / 2.0, origin_y + monitor_height * 0.12)
        } else {
            (
                origin_x + monitor_width - width - 16.0,
                origin_y + monitor_height - height - 72.0,
            )
        };
        window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_ignore_cursor_events(true);
    let _ = app.emit_to(OVERLAY_LABEL, "overlay-state", state);
    Ok(())
}

#[tauri::command]
pub fn get_overlay_state(app: AppHandle) -> serde_json::Value {
    app.state::<AppState>()
        .overlay
        .lock()
        .map(|state| state.clone())
        .unwrap_or(serde_json::Value::Null)
}

/// Flash a big number on every display for a few seconds so the tutor can tell
/// which entry in the display picker is which.
#[tauri::command]
pub fn identify_displays(app: AppHandle) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("identify-{index}");
        if app.get_webview_window(&label).is_some() {
            continue;
        }
        let scale = monitor.scale_factor().max(0.5);
        let x = monitor.position().x as f64 / scale + 48.0;
        let y = monitor.position().y as f64 / scale + 48.0;
        let window = make_overlay_window(
            &app,
            &label,
            &format!("overlay.html?identify={}", index + 1),
            220.0,
            220.0,
        )?;
        let _ = window.set_position(LogicalPosition::new(x, y));
        let _ = window.show();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(4)).await;
            if let Some(window) = app_handle.get_webview_window(&label) {
                let _ = window.close();
            }
        });
    }
    Ok(())
}
