//! The macOS Screen Recording permission (System Settings → Privacy &
//! Security → Screen & System Audio Recording; "Screen Recording" before
//! macOS 15).
//!
//! Without it macOS still lets the recorder run, but refuses what it records:
//! ScreenCaptureKit declines to capture a shared window or the system audio
//! ("The user declined TCCs for application, window, display capture"), and
//! CGWindowListCopyWindowInfo leaves every window's title out. Nothing said
//! so until this check existed, so a tutor whose Mac blocked it — a "Don't
//! Allow", parental controls, a management profile — saw untitled windows in
//! the picker and a frozen picture once class started.
//!
//! macOS reads the permission when an app starts: a grant made while the
//! recorder is running only applies after it is quit and reopened.
//!
//! Declared by hand, like the calls in windowlist.rs.

/// "granted" or "denied" on macOS; "unsupported" elsewhere, where there is
/// no such permission.
#[tauri::command]
pub fn screen_capture_access() -> String {
    platform::access().to_string()
}

/// Ask macOS for the permission. It shows its prompt only the first time an
/// app ever asks, and never when a policy (parental controls) decides; either
/// way the answer stays "denied" for the rest of this run, because a grant
/// takes effect only after a restart. Same answers as `screen_capture_access`.
#[tauri::command]
pub fn request_screen_capture_access() -> String {
    platform::request().to_string()
}

/// Open System Settings at the Screen & System Audio Recording list.
#[tauri::command]
pub async fn open_screen_capture_settings() -> Result<(), String> {
    platform::open_settings()
}

#[cfg(target_os = "macos")]
mod platform {
    // Both since macOS 10.15. They return C's bool, read as a byte like the
    // other CoreGraphics bools in windowlist.rs.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> u8;
        fn CGRequestScreenCaptureAccess() -> u8;
    }

    /// Privacy & Security, scrolled to the Screen (& System Audio) Recording list.
    const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

    fn answer(granted: u8) -> &'static str {
        if granted != 0 {
            "granted"
        } else {
            "denied"
        }
    }

    pub fn access() -> &'static str {
        answer(unsafe { CGPreflightScreenCaptureAccess() })
    }

    pub fn request() -> &'static str {
        answer(unsafe { CGRequestScreenCaptureAccess() })
    }

    pub fn open_settings() -> Result<(), String> {
        let status = std::process::Command::new("/usr/bin/open")
            .arg(SETTINGS_URL)
            .status()
            .map_err(|error| format!("Could not open System Settings: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("Could not open System Settings ({status})."))
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn access() -> &'static str {
        "unsupported"
    }

    pub fn request() -> &'static str {
        "unsupported"
    }

    pub fn open_settings() -> Result<(), String> {
        Err("Only macOS has a Screen Recording permission.".into())
    }
}
