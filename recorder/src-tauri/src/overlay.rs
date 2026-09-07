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

/// Which corner of the recorded display the status pill sits in. The tutor
/// drags it; the blocking banner ignores this and stays centred, because it is
/// an alert rather than furniture.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("bottom-right") {
            "top-left" => Corner::TopLeft,
            "top-right" => Corner::TopRight,
            "bottom-left" => Corner::BottomLeft,
            _ => Corner::BottomRight,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Corner::TopLeft => "top-left",
            Corner::TopRight => "top-right",
            Corner::BottomLeft => "bottom-left",
            Corner::BottomRight => "bottom-right",
        }
    }
}

/// Clear of the screen edge, and of the taskbar or dock along the bottom.
const OVERLAY_MARGIN: f64 = 16.0;
const OVERLAY_BOTTOM_MARGIN: f64 = 72.0;

/// A monitor's logical geometry: origin and size in the same units window
/// positions use.
fn monitor_bounds(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor().max(0.5);
    (
        monitor.position().x as f64 / scale,
        monitor.position().y as f64 / scale,
        monitor.size().width as f64 / scale,
        monitor.size().height as f64 / scale,
    )
}

fn corner_position(monitor: &Monitor, corner: Corner, width: f64, height: f64) -> (f64, f64) {
    let (origin_x, origin_y, monitor_width, monitor_height) = monitor_bounds(monitor);
    let left = origin_x + OVERLAY_MARGIN;
    let right = origin_x + monitor_width - width - OVERLAY_MARGIN;
    let top = origin_y + OVERLAY_MARGIN;
    let bottom = origin_y + monitor_height - height - OVERLAY_BOTTOM_MARGIN;
    match corner {
        Corner::TopLeft => (left, top),
        Corner::TopRight => (right, top),
        Corner::BottomLeft => (left, bottom),
        Corner::BottomRight => (right, bottom),
    }
}

/// The corner an overlay sitting at this position belongs to — whichever
/// quadrant of the display its middle landed in.
fn nearest_corner(monitor: &Monitor, x: f64, y: f64, width: f64, height: f64) -> Corner {
    let (origin_x, origin_y, monitor_width, monitor_height) = monitor_bounds(monitor);
    let middle_x = x + width / 2.0 - origin_x;
    let middle_y = y + height / 2.0 - origin_y;
    let left = middle_x < monitor_width / 2.0;
    let top = middle_y < monitor_height / 2.0;
    match (top, left) {
        (true, true) => Corner::TopLeft,
        (true, false) => Corner::TopRight,
        (false, true) => Corner::BottomLeft,
        (false, false) => Corner::BottomRight,
    }
}

/// The overlay state the webview last sent, for the commands the *overlay*
/// window calls — it knows nothing about which display it is on.
fn last_overlay_field(app: &AppHandle, key: &str) -> Option<serde_json::Value> {
    app.state::<AppState>()
        .overlay
        .lock()
        .ok()
        .and_then(|state| state.get(key).cloned())
}

fn overlay_display_index(app: &AppHandle) -> Option<usize> {
    last_overlay_field(app, "displayIndex")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
}

fn overlay_corner(app: &AppHandle) -> Corner {
    let value = last_overlay_field(app, "corner");
    Corner::parse(value.as_ref().and_then(|value| value.as_str()))
}

fn logical_geometry(window: &tauri::WebviewWindow) -> Result<(f64, f64, f64, f64), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?.max(0.5);
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok((
        position.x as f64 / scale,
        position.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

/// Move the pill while the tutor drags it. Deltas, because the webview knows
/// how far the pointer moved but not where the window is.
#[tauri::command]
pub fn nudge_overlay(app: AppHandle, dx: f64, dy: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return Ok(());
    };
    let (x, y, _, _) = logical_geometry(&window)?;
    window
        .set_position(LogicalPosition::new(x + dx, y + dy))
        .map_err(|e| e.to_string())
}

/// Drop the pill into the nearest corner and say which one, so the webview can
/// remember it for next time.
#[tauri::command]
pub fn snap_overlay(app: AppHandle) -> Result<String, String> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return Ok(Corner::BottomRight.name().to_string());
    };
    let (x, y, width, height) = logical_geometry(&window)?;
    let Some(monitor) = monitor_for(&app, overlay_display_index(&app)) else {
        return Ok(Corner::BottomRight.name().to_string());
    };
    let corner = nearest_corner(&monitor, x, y, width, height);
    let _ = app.emit_to("main", "overlay-corner", corner.name());
    let (snapped_x, snapped_y) = corner_position(&monitor, corner, width, height);
    window
        .set_position(LogicalPosition::new(snapped_x, snapped_y))
        .map_err(|e| e.to_string())?;
    Ok(corner.name().to_string())
}

/// The pill is only as big as its text, so the window has to be too: it is the
/// one overlay that takes mouse input, and every pixel of it that is not the
/// pill is a pixel of the lesson the tutor cannot click.
#[tauri::command]
pub fn resize_overlay(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return Ok(());
    };
    let width = width.clamp(80.0, 900.0);
    let height = height.clamp(28.0, 400.0);
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    if let Some(monitor) = monitor_for(&app, overlay_display_index(&app)) {
        let (x, y) = corner_position(&monitor, overlay_corner(&app), width, height);
        window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

const GUIDES_LABEL: &str = "overlay-guides";

/// While the tutor holds the pill, a transparent sheet over the whole recorded
/// display shows a dashed outline in each corner, so it is obvious the thing
/// can be moved and where it can go. Click-through and content-protected like
/// every other overlay, so it neither blocks the drag nor lands in a recording.
///
/// Async: it creates a window the first time (see `set_overlay`).
#[tauri::command]
pub async fn show_corner_guides(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(monitor) = monitor_for(&app, overlay_display_index(&app)) else {
        return Ok(());
    };
    let (origin_x, origin_y, monitor_width, monitor_height) = monitor_bounds(&monitor);
    let window = match app.get_webview_window(GUIDES_LABEL) {
        Some(window) => window,
        None => make_overlay_window(
            &app,
            GUIDES_LABEL,
            "overlay.html?guides=1",
            monitor_width,
            monitor_height,
        )?,
    };
    window
        .set_size(LogicalSize::new(monitor_width, monitor_height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(origin_x, origin_y))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_ignore_cursor_events(true);
    // Sent every time rather than baked into the URL: the pill's size changes
    // with its text, and the outlines have to match what is being dragged.
    let _ = app.emit_to(
        GUIDES_LABEL,
        "corner-guides",
        serde_json::json!({
            "width": width,
            "height": height,
            "margin": OVERLAY_MARGIN,
            "bottomMargin": OVERLAY_BOTTOM_MARGIN,
        }),
    );
    Ok(())
}

#[tauri::command]
pub fn hide_corner_guides(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(GUIDES_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `state`: { mode, title, detail, blocking, displayIndex }. mode "hidden" hides it.
///
/// Async on purpose: this builds a window the first time it is called, and on
/// Windows building one inside a *synchronous* command deadlocks against the
/// WebView2 message loop — which meant the overlay never appeared and the
/// caller never got its promise back.
#[tauri::command]
pub async fn set_overlay(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
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
    // The pill resizes itself to its text once the page has laid out; this is
    // only the size it first appears at.
    let (width, height) = if blocking { (560.0, 150.0) } else { (280.0, 44.0) };
    let corner = Corner::parse(state.get("corner").and_then(|value| value.as_str()));

    let window = match app.get_webview_window(OVERLAY_LABEL) {
        Some(window) => window,
        None => make_overlay_window(&app, OVERLAY_LABEL, "overlay.html", width, height)?,
    };

    // The banner has a fixed size; the pill has already sized itself to its
    // text, and re-imposing a default here would make it jump on every state
    // change.
    let (place_width, place_height) = if blocking {
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        (width, height)
    } else {
        logical_geometry(&window)
            .map(|(_, _, current_width, current_height)| (current_width, current_height))
            .unwrap_or((width, height))
    };
    if let Some(monitor) = monitor_for(&app, display_index) {
        let (origin_x, origin_y, monitor_width, monitor_height) = monitor_bounds(&monitor);
        let (x, y) = if blocking {
            (origin_x + (monitor_width - place_width) / 2.0, origin_y + monitor_height * 0.12)
        } else {
            corner_position(&monitor, corner, place_width, place_height)
        };
        window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_always_on_top(true);
    // The pill is draggable, so it has to take mouse input. The banner stays
    // click-through: it is large, centred, and must never sit between the tutor
    // and what they are teaching with.
    let _ = window.set_ignore_cursor_events(blocking);
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
///
/// Async for the same reason as `set_overlay`: it creates windows.
#[tauri::command]
pub async fn identify_displays(app: AppHandle) -> Result<(), String> {
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
