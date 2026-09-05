//! Enumerating open windows and tracking which one has focus.
//!
//! Used by "record specific windows" mode: the tutor picks the windows they
//! are willing to share, and the recorder only shows the focused one, provided
//! it is on that list (see src/main.js).
//!
//! The platform calls are declared by hand rather than pulled from a binding
//! crate. There are only a dozen of them, they are stable C APIs, and doing it
//! this way keeps the dependency tree — and the ways a build can break — where
//! they were.
//!
//! Coordinates are whatever the platform's own window space uses: physical
//! pixels on Windows (the app is per-monitor DPI aware), points on macOS. The
//! caller converts to the recorded display's pixels; `scaled` says whether that
//! conversion is needed.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// Stable for as long as the window exists (HWND on Windows, CGWindowID on macOS).
    pub id: u64,
    pub title: String,
    /// Application name — what the tutor recognises in the picker.
    pub app: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// True when the bounds are in points and must be multiplied by the
    /// display's scale factor to reach capture pixels (macOS).
    pub scaled: bool,
    /// This is one of the recorder's own windows: never offered for sharing.
    pub own: bool,
}

/// Windows too small to be worth listing (tooltips, stray helper windows).
const MIN_SIDE: u32 = 80;

#[cfg(windows)]
mod platform {
    use super::{WindowInfo, MIN_SIDE};
    use std::ffi::c_void;

    type Hwnd = *mut c_void;
    type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
    const DWMWA_CLOAKED: u32 = 14;
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: extern "system" fn(Hwnd, isize) -> i32, param: isize) -> i32;
        fn IsWindowVisible(window: Hwnd) -> i32;
        fn IsIconic(window: Hwnd) -> i32;
        fn GetWindowTextW(window: Hwnd, text: *mut u16, count: i32) -> i32;
        fn GetWindowTextLengthW(window: Hwnd) -> i32;
        fn GetWindowRect(window: Hwnd, rect: *mut Rect) -> i32;
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowLongW(window: Hwnd, index: i32) -> i32;
        fn GetWindowThreadProcessId(window: Hwnd, process_id: *mut u32) -> u32;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(
            window: Hwnd,
            attribute: u32,
            value: *mut c_void,
            size: u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcessId() -> u32;
        fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    fn window_title(window: Hwnd) -> String {
        unsafe {
            let length = GetWindowTextLengthW(window);
            if length <= 0 {
                return String::new();
            }
            let mut buffer = vec![0u16; length as usize + 1];
            let written = GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32);
            if written <= 0 {
                return String::new();
            }
            String::from_utf16_lossy(&buffer[..written as usize])
        }
    }

    fn process_id(window: Hwnd) -> u32 {
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
        pid
    }

    /// The executable's file name ("chrome.exe" → "chrome"), title-cased enough
    /// to be recognisable in the picker.
    fn app_name(pid: u32) -> String {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return String::new();
            }
            let mut buffer = vec![0u16; 520];
            let mut size = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 || size == 0 {
                return String::new();
            }
            let full = String::from_utf16_lossy(&buffer[..size as usize]);
            let file = full.rsplit(['\\', '/']).next().unwrap_or(&full);
            let stem = file.strip_suffix(".exe").unwrap_or(file);
            let mut chars = stem.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        }
    }

    fn is_cloaked(window: Hwnd) -> bool {
        let mut cloaked: u32 = 0;
        let result = unsafe {
            DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut c_void,
                std::mem::size_of::<u32>() as u32,
            )
        };
        result == 0 && cloaked != 0
    }

    /// `GetWindowRect` includes the invisible resize border, which would drag a
    /// few pixels of whatever is behind the window into the crop. The DWM frame
    /// bounds are what the user actually sees.
    fn frame_rect(window: Hwnd) -> Option<Rect> {
        let mut rect = Rect::default();
        let result = unsafe {
            DwmGetWindowAttribute(
                window,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut Rect as *mut c_void,
                std::mem::size_of::<Rect>() as u32,
            )
        };
        if result == 0 && rect.right > rect.left && rect.bottom > rect.top {
            return Some(rect);
        }
        let mut rect = Rect::default();
        if unsafe { GetWindowRect(window, &mut rect) } != 0 && rect.right > rect.left {
            Some(rect)
        } else {
            None
        }
    }

    fn describe(window: Hwnd) -> Option<WindowInfo> {
        if window.is_null() || unsafe { IsWindowVisible(window) } == 0 {
            return None;
        }
        if unsafe { IsIconic(window) } != 0 || is_cloaked(window) {
            return None;
        }
        let ex_style = unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32;
        if ex_style & WS_EX_TOOLWINDOW != 0 {
            return None;
        }
        let rect = frame_rect(window)?;
        let width = (rect.right - rect.left).max(0) as u32;
        let height = (rect.bottom - rect.top).max(0) as u32;
        if width < MIN_SIDE || height < MIN_SIDE {
            return None;
        }
        let pid = process_id(window);
        let title = window_title(window);
        let app = app_name(pid);
        if title.trim().is_empty() && app.trim().is_empty() {
            return None;
        }
        Some(WindowInfo {
            id: window as usize as u64,
            title,
            app,
            x: rect.left,
            y: rect.top,
            width,
            height,
            scaled: false,
            own: pid == unsafe { GetCurrentProcessId() },
        })
    }

    // EnumWindows hands each window to this; the Vec is passed as its lParam.
    extern "system" fn collect(window: Hwnd, param: isize) -> i32 {
        let found = unsafe { &mut *(param as *mut Vec<WindowInfo>) };
        if let Some(info) = describe(window) {
            found.push(info);
        }
        1
    }

    pub fn list() -> Vec<WindowInfo> {
        let mut found: Vec<WindowInfo> = Vec::new();
        unsafe { EnumWindows(collect, &mut found as *mut Vec<WindowInfo> as isize) };
        found
    }

    pub fn focused() -> Option<WindowInfo> {
        describe(unsafe { GetForegroundWindow() })
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{WindowInfo, MIN_SIDE};
    use std::ffi::{c_void, CString};

    type CfTypeRef = *const c_void;
    type CfArrayRef = *const c_void;
    type CfDictionaryRef = *const c_void;
    type CfStringRef = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CgPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CgSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CgRect {
        origin: CgPoint,
        size: CgSize,
    }

    const KCG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
    const KCG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;
    const KCG_NULL_WINDOW_ID: u32 = 0;
    const KCF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    /// kCFNumberSInt64Type. CFNumberType is a CFIndex, i.e. pointer-sized.
    const KCF_NUMBER_SINT64: isize = 4;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CfArrayRef;
        fn CGRectMakeWithDictionaryRepresentation(dict: CfDictionaryRef, rect: *mut CgRect) -> u8;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CfArrayRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CfArrayRef, index: isize) -> CfTypeRef;
        fn CFDictionaryGetValue(dict: CfDictionaryRef, key: CfTypeRef) -> CfTypeRef;
        fn CFStringCreateWithCString(
            allocator: CfTypeRef,
            cstr: *const i8,
            encoding: u32,
        ) -> CfStringRef;
        fn CFStringGetCString(
            string: CfStringRef,
            buffer: *mut i8,
            size: isize,
            encoding: u32,
        ) -> u8;
        fn CFNumberGetValue(number: CfTypeRef, kind: isize, value: *mut c_void) -> u8;
        fn CFRelease(value: CfTypeRef);
    }

    /// A CFString for a dictionary key. The caller releases it.
    fn key(name: &str) -> CfStringRef {
        let Ok(text) = CString::new(name) else {
            return std::ptr::null();
        };
        unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), KCF_STRING_ENCODING_UTF8) }
    }

    /// CFRelease crashes on null, which `key` can return.
    unsafe fn release(value: CfTypeRef) {
        if !value.is_null() {
            CFRelease(value);
        }
    }

    fn string_value(dict: CfDictionaryRef, name: &str) -> String {
        unsafe {
            let key_ref = key(name);
            let value = if key_ref.is_null() { std::ptr::null() } else { CFDictionaryGetValue(dict, key_ref) };
            release(key_ref);
            if value.is_null() {
                return String::new();
            }
            let mut buffer = vec![0i8; 512];
            if CFStringGetCString(
                value,
                buffer.as_mut_ptr(),
                buffer.len() as isize,
                KCF_STRING_ENCODING_UTF8,
            ) == 0
            {
                return String::new();
            }
            let bytes: Vec<u8> = buffer
                .iter()
                .take_while(|byte| **byte != 0)
                .map(|byte| *byte as u8)
                .collect();
            String::from_utf8_lossy(&bytes).to_string()
        }
    }

    fn number_value(dict: CfDictionaryRef, name: &str) -> Option<i64> {
        unsafe {
            let key_ref = key(name);
            let value = if key_ref.is_null() { std::ptr::null() } else { CFDictionaryGetValue(dict, key_ref) };
            release(key_ref);
            if value.is_null() {
                return None;
            }
            let mut out: i64 = 0;
            if CFNumberGetValue(value, KCF_NUMBER_SINT64, &mut out as *mut i64 as *mut c_void) == 0 {
                return None;
            }
            Some(out)
        }
    }

    fn bounds_value(dict: CfDictionaryRef) -> Option<CgRect> {
        unsafe {
            let key_ref = key("kCGWindowBounds");
            let value = if key_ref.is_null() { std::ptr::null() } else { CFDictionaryGetValue(dict, key_ref) };
            release(key_ref);
            if value.is_null() {
                return None;
            }
            let mut rect = CgRect::default();
            if CGRectMakeWithDictionaryRepresentation(value, &mut rect) == 0 {
                return None;
            }
            Some(rect)
        }
    }

    fn own_pid() -> i64 {
        std::process::id() as i64
    }

    /// Every on-screen window, front-most first — the order CoreGraphics
    /// returns is the stacking order, which is how we know what has focus
    /// without asking for Accessibility permission.
    fn collect() -> Vec<WindowInfo> {
        let mut out = Vec::new();
        unsafe {
            let array = CGWindowListCopyWindowInfo(
                KCG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | KCG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS,
                KCG_NULL_WINDOW_ID,
            );
            if array.is_null() {
                return out;
            }
            let count = CFArrayGetCount(array);
            for index in 0..count {
                let dict = CFArrayGetValueAtIndex(array, index);
                if dict.is_null() {
                    continue;
                }
                // Layer 0 is the normal window layer: menu bar, dock and
                // floating panels sit on other layers and are not shareable.
                if number_value(dict, "kCGWindowLayer").unwrap_or(-1) != 0 {
                    continue;
                }
                let Some(rect) = bounds_value(dict) else { continue };
                let width = rect.size.width.max(0.0) as u32;
                let height = rect.size.height.max(0.0) as u32;
                if width < MIN_SIDE || height < MIN_SIDE {
                    continue;
                }
                let Some(id) = number_value(dict, "kCGWindowNumber") else { continue };
                let app = string_value(dict, "kCGWindowOwnerName");
                // The title needs Screen Recording permission, which the app
                // already holds to record at all; without it this is empty and
                // the picker falls back to the application name.
                let title = string_value(dict, "kCGWindowName");
                if app.trim().is_empty() && title.trim().is_empty() {
                    continue;
                }
                let pid = number_value(dict, "kCGWindowOwnerPID").unwrap_or(-1);
                out.push(WindowInfo {
                    id: id as u64,
                    title,
                    app,
                    x: rect.origin.x as i32,
                    y: rect.origin.y as i32,
                    width,
                    height,
                    scaled: true,
                    own: pid == own_pid(),
                });
            }
            release(array);
        }
        out
    }

    pub fn list() -> Vec<WindowInfo> {
        collect()
    }

    pub fn focused() -> Option<WindowInfo> {
        collect().into_iter().next()
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::WindowInfo;

    pub fn list() -> Vec<WindowInfo> {
        Vec::new()
    }

    pub fn focused() -> Option<WindowInfo> {
        None
    }
}

/// Windows the tutor can choose to share. The recorder's own windows are left
/// out — sharing them would be pointless — but `focused_window` still reports
/// them, so focusing the recorder correctly counts as "not a shared window".
#[tauri::command]
pub fn list_windows() -> Vec<WindowInfo> {
    let mut windows: Vec<WindowInfo> = platform::list().into_iter().filter(|w| !w.own).collect();
    windows.sort_by(|a, b| {
        a.app
            .to_lowercase()
            .cmp(&b.app.to_lowercase())
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    windows
}

/// The window that currently has focus, or `None` when that cannot be
/// determined — which the caller must treat as "not shared".
#[tauri::command]
pub fn focused_window() -> Option<WindowInfo> {
    platform::focused()
}
