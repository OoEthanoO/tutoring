//! Screen + audio capture through the bundled ffmpeg sidecar.
//!
//! Every recording is a series of *segments*: one ffmpeg process per stretch of
//! uninterrupted recording (pausing stops the process; resuming starts a new
//! one). Segments are fragmented MP4 so a crash mid-segment still leaves a
//! playable file, and `concat_segments` stitches them into the final upload
//! without re-encoding.
//!
//! Quality profile (chosen for readable text at a low CPU cost — see
//! RECORDER.md): the selected display scaled to 720p (1080p when the display
//! is larger than 1440p, so 4K text stays legible), 10 fps, H.264 (libx264
//! `superfast` CRF 26, or a hardware encoder when one is available) and 64 kbps
//! mono AAC. Roughly 60–120 MB per hour of class.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::{sysaudio, windowfeed, AppState};

pub struct CaptureSession {
    child: Child,
    started_at: Instant,
    output_path: PathBuf,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    backend: String,
    encoder: String,
}

impl CaptureSession {
    /// Ask ffmpeg to finish cleanly (`q` on stdin), killing it if it hangs.
    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(mut stdin) = self.child.stdin.take() {
            let _ = stdin.write_all(b"q\n");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) => {
                    if Instant::now() > deadline {
                        let _ = self.child.kill();
                        let _ = self.child.wait();
                        return Ok(());
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(err) => return Err(err.to_string()),
            }
        }
    }

    fn stderr_lines(&self) -> Vec<String> {
        self.stderr_tail
            .lock()
            .map(|tail| tail.iter().cloned().collect())
            .unwrap_or_default()
    }
}

fn target_triple() -> &'static str {
    if cfg!(all(windows, target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(windows, target_arch = "aarch64")) {
        "aarch64-pc-windows-msvc"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else {
        "unknown"
    }
}

/// Locate a bundled sidecar (`ffmpeg`, `sysaudio`). Tauri places sidecars next
/// to the executable in a bundle; in `tauri dev` they live in
/// `src-tauri/binaries/<name>-<target triple>`.
pub fn sidecar_path(name: &str) -> Result<PathBuf, String> {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(format!("{name}{ext}"));
            if bundled.exists() {
                return Ok(bundled);
            }
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("{name}-{}{ext}", target_triple()));
    if dev.exists() {
        return Ok(dev);
    }
    Err(format!(
        "The bundled {name} binary was not found (looked next to the app and at {}).",
        dev.display()
    ))
}

/// A `Command` that never pops up a console window on Windows.
pub fn command(program: &Path) -> Command {
    // Only the Windows branch below mutates it.
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn run_for_stderr(program: &Path, args: &[&str]) -> String {
    match command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) => String::from_utf8_lossy(&output.stderr).to_string(),
        Err(_) => String::new(),
    }
}

fn run_for_stdout(program: &Path, args: &[&str]) -> String {
    match command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    {
        Ok(output) => String::from_utf8_lossy(&output.stdout).to_string(),
        Err(_) => String::new(),
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ScreenDevice {
    pub index: u32,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProbe {
    pub ffmpeg_ok: bool,
    pub ffmpeg_version: String,
    pub microphones: Vec<AudioDevice>,
    /// Output devices whose audio can be captured (Windows only; macOS
    /// captures the system mix regardless of device).
    pub outputs: Vec<AudioDevice>,
    /// macOS avfoundation video devices ("Capture screen N" entries map to displays).
    pub screens: Vec<ScreenDevice>,
    /// H.264 encoders available in the bundled ffmpeg, best first.
    pub encoders: Vec<String>,
    /// "loopback" (Windows WASAPI), "helper" (macOS ScreenCaptureKit), or "none".
    pub system_audio: String,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn probe_capture() -> Result<CaptureProbe, String> {
    tauri::async_runtime::spawn_blocking(probe_blocking)
        .await
        .map_err(|e| e.to_string())?
}

fn probe_blocking() -> Result<CaptureProbe, String> {
    let mut warnings = Vec::new();
    let ffmpeg = match sidecar_path("ffmpeg") {
        Ok(path) => path,
        Err(err) => {
            return Ok(CaptureProbe {
                ffmpeg_ok: false,
                ffmpeg_version: String::new(),
                microphones: vec![],
                outputs: vec![],
                screens: vec![],
                encoders: vec![],
                system_audio: "none".into(),
                warnings: vec![err],
            })
        }
    };

    let version_text = run_for_stdout(&ffmpeg, &["-version"]);
    let ffmpeg_version = version_text.lines().next().unwrap_or("").trim().to_string();
    let ffmpeg_ok = ffmpeg_version.starts_with("ffmpeg");

    let encoder_text = run_for_stdout(&ffmpeg, &["-hide_banner", "-encoders"]);
    let has_encoder = |name: &str| {
        encoder_text
            .lines()
            .any(|line| line.split_whitespace().nth(1) == Some(name))
    };
    let preferred: &[&str] = if cfg!(windows) {
        &["h264_nvenc", "h264_qsv", "h264_amf", "libx264"]
    } else {
        &["h264_videotoolbox", "libx264"]
    };
    let encoders: Vec<String> = preferred
        .iter()
        .filter(|name| has_encoder(name))
        .map(|name| name.to_string())
        .collect();
    if encoders.is_empty() {
        warnings.push("No H.264 encoder found in the bundled ffmpeg.".into());
    }

    #[cfg(windows)]
    let (microphones, screens) = (list_dshow_audio(&ffmpeg), Vec::<ScreenDevice>::new());
    #[cfg(target_os = "macos")]
    let (screens, microphones) = list_avfoundation(&ffmpeg);
    #[cfg(not(any(windows, target_os = "macos")))]
    let (microphones, screens) = (Vec::<AudioDevice>::new(), Vec::<ScreenDevice>::new());

    #[cfg(windows)]
    let outputs = match sysaudio::list_output_devices() {
        Ok(list) => list,
        Err(err) => {
            warnings.push(format!("Could not list output devices: {err}"));
            vec![]
        }
    };
    #[cfg(not(windows))]
    let outputs: Vec<AudioDevice> = vec![];

    let system_audio = if cfg!(windows) {
        "loopback".to_string()
    } else if cfg!(target_os = "macos") && sidecar_path("sysaudio").is_ok() {
        "helper".to_string()
    } else {
        "none".to_string()
    };

    Ok(CaptureProbe {
        ffmpeg_ok,
        ffmpeg_version,
        microphones,
        outputs,
        screens,
        encoders,
        system_audio,
        warnings,
    })
}

#[cfg(windows)]
fn list_dshow_audio(ffmpeg: &Path) -> Vec<AudioDevice> {
    let text = run_for_stderr(
        ffmpeg,
        &["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
    );
    // Modern ffmpeg:   [dshow @ ...] "Microphone (Realtek Audio)" (audio)
    //                  [dshow @ ...]   Alternative name "@device_cm_{...}"
    // Older ffmpeg:    [dshow @ ...] DirectShow audio devices
    //                  [dshow @ ...]  "Microphone (Realtek Audio)"
    let modern = regex::Regex::new(r#""([^"]+)"\s*\((audio|video|audio, video)\)\s*$"#).unwrap();
    let legacy = regex::Regex::new(r#"^\[dshow @ [^\]]+\]\s+"([^"]+)"\s*$"#).unwrap();
    let alternative = regex::Regex::new(r#"Alternative name\s+"([^"]+)""#).unwrap();

    let mut devices: Vec<AudioDevice> = Vec::new();
    let mut in_audio_section = false;
    // (friendly name, is audio) awaiting its optional "Alternative name" line.
    let mut pending: Option<(String, bool)> = None;
    let flush = |pending: &mut Option<(String, bool)>, devices: &mut Vec<AudioDevice>| {
        if let Some((name, is_audio)) = pending.take() {
            if is_audio {
                devices.push(AudioDevice { id: name.clone(), name });
            }
        }
    };

    for raw in text.lines() {
        let line = raw.trim_end();
        if line.contains("DirectShow audio devices") {
            flush(&mut pending, &mut devices);
            in_audio_section = true;
            continue;
        }
        if line.contains("DirectShow video devices") {
            flush(&mut pending, &mut devices);
            in_audio_section = false;
            continue;
        }
        if let Some(caps) = alternative.captures(line) {
            if let Some((name, is_audio)) = pending.take() {
                if is_audio {
                    devices.push(AudioDevice { id: caps[1].to_string(), name });
                }
            }
            continue;
        }
        if let Some(caps) = modern.captures(line) {
            flush(&mut pending, &mut devices);
            pending = Some((caps[1].to_string(), caps[2].contains("audio")));
            continue;
        }
        if let Some(caps) = legacy.captures(line) {
            flush(&mut pending, &mut devices);
            pending = Some((caps[1].to_string(), in_audio_section));
        }
    }
    flush(&mut pending, &mut devices);
    devices
}

#[cfg(target_os = "macos")]
fn list_avfoundation(ffmpeg: &Path) -> (Vec<ScreenDevice>, Vec<AudioDevice>) {
    let text = run_for_stderr(
        ffmpeg,
        &["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    );
    let entry = regex::Regex::new(r"\[(\d+)\]\s+(.+)$").unwrap();
    let mut screens = Vec::new();
    let mut audio = Vec::new();
    let mut section = "";
    for line in text.lines() {
        if line.contains("AVFoundation video devices") {
            section = "video";
            continue;
        }
        if line.contains("AVFoundation audio devices") {
            section = "audio";
            continue;
        }
        let Some(caps) = entry.captures(line) else { continue };
        let index: u32 = caps[1].parse().unwrap_or(0);
        let name = caps[2].trim().to_string();
        match section {
            "video" => screens.push(ScreenDevice { index, name }),
            "audio" => audio.push(AudioDevice { id: index.to_string(), name }),
            _ => {}
        }
    }
    (screens, audio)
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CaptureConfig {
    pub output_path: String,
    /// Position and size of the chosen display in physical pixels.
    pub display_x: i32,
    pub display_y: i32,
    pub display_width: u32,
    pub display_height: u32,
    /// Only one display is attached (allows the cheaper Desktop Duplication path on Windows).
    pub single_display: bool,
    /// macOS: avfoundation index of the "Capture screen N" device for the chosen display.
    pub screen_device_index: Option<u32>,
    /// Microphone id (dshow alternative name on Windows, avfoundation index on macOS). None = no mic.
    pub microphone_id: Option<String>,
    /// Windows: WASAPI id of the output device to capture as system audio.
    pub output_device_id: Option<String>,
    /// Capture system audio (students' voices) at all.
    pub system_audio: bool,
    /// Windows: "ddagrab" or "gdigrab"; macOS: "avfoundation".
    pub backend: Option<String>,
    /// One of the encoders reported by `probe_capture`.
    pub encoder: Option<String>,
    pub fps: Option<u32>,
    /// Window mode: the window to record (HWND on Windows, CGWindowID on
    /// macOS). Captured on its own through windowfeed.rs — never by cropping
    /// the screen, which would record anything drawn over the window. None
    /// records the whole display.
    pub window_id: Option<String>,
    /// Freeze mode: loop this still image instead of capturing the screen,
    /// while the microphone and system audio keep recording.
    pub still_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStarted {
    pub backend: String,
    pub encoder: String,
    pub system_audio: bool,
    pub warnings: Vec<String>,
}

fn even(value: u32) -> u32 {
    (value & !1).max(2)
}

/// The fixed size every segment of a class is encoded at. Derived from the
/// recorded display so display-mode output is unchanged; window and frozen
/// segments are letterboxed into the same rectangle.
fn canvas_for(config: &CaptureConfig, target_height: Option<u32>) -> (u32, u32) {
    let height = target_height.unwrap_or(config.display_height).max(2);
    let width = if config.display_height == 0 {
        config.display_width
    } else {
        ((config.display_width as f64) * (height as f64) / (config.display_height as f64)).round()
            as u32
    };
    (even(width), even(height))
}

/// 720p normally; 1080p for displays above 1440p so small text survives.
fn target_height_for(display_height: u32) -> Option<u32> {
    if display_height > 1440 {
        Some(1080)
    } else if display_height > 720 {
        Some(720)
    } else {
        None
    }
}

fn default_backend(config: &CaptureConfig) -> String {
    if cfg!(windows) {
        if config.single_display {
            "ddagrab".to_string()
        } else {
            "gdigrab".to_string()
        }
    } else {
        "avfoundation".to_string()
    }
}

fn push_all(args: &mut Vec<String>, items: &[&str]) {
    args.extend(items.iter().map(|item| item.to_string()));
}

/// A microphone as its own input, for segments whose picture does not come
/// from a screen grabber (a frozen still, or a window from the window feeder).
fn push_microphone_input(args: &mut Vec<String>, mic: &str) {
    if cfg!(windows) {
        push_all(
            args,
            &[
                "-f", "dshow",
                "-thread_queue_size", "1024",
                "-rtbufsize", "64M",
                "-i", &format!("audio={mic}"),
            ],
        );
    } else {
        // No video device on this input: the picture comes from elsewhere.
        push_all(
            args,
            &[
                "-f", "avfoundation",
                "-thread_queue_size", "512",
                "-i", &format!(":{mic}"),
            ],
        );
    }
}

fn build_args(
    config: &CaptureConfig,
    backend: &str,
    encoder: &str,
    fps: u32,
    target_height: Option<u32>,
    system_audio_port: Option<u16>,
    window_port: Option<u16>,
) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = Vec::new();
    push_all(&mut args, &["-y", "-hide_banner", "-loglevel", "warning", "-nostats"]);

    let fps_text = fps.to_string();
    let (canvas_width, canvas_height) = canvas_for(config, target_height);

    // Every segment of a class is encoded onto the same canvas whatever it
    // captured — the whole display, a window of any shape, or a frozen still —
    // so that they still concatenate at the end without re-encoding.
    let fill = format!("scale={canvas_width}:{canvas_height},setsar=1,format=yuv420p");
    let fit = format!(
        "scale={canvas_width}:{canvas_height}:force_original_aspect_ratio=decrease,pad={canvas_width}:{canvas_height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p"
    );
    let screen_filter = fill.clone();

    let mut filter_parts: Vec<String> = Vec::new();
    let mut next_input = 0usize;
    let mut audio_inputs: Vec<usize> = Vec::new();
    let video_map: String;
    // Applied with -vf when the video comes from a real input (not a filter source).
    let mut video_filter: Option<String> = None;

    let microphone = config
        .microphone_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let still = config
        .still_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());

    if let Some(still) = still {
        // Frozen picture: the tutor is on a window they did not share, so the
        // video holds the last frame of the last shared window while the
        // microphone and system audio keep recording. `-re` paces the looped
        // image to real time so it cannot run ahead of the live audio.
        if Path::new(still).exists() {
            push_all(
                &mut args,
                &["-re", "-loop", "1", "-framerate", &fps_text, "-i", still],
            );
        } else {
            // Nothing shared has been recorded yet (or the still could not be
            // made): hold a black picture rather than failing to record at all.
            push_all(
                &mut args,
                &[
                    "-re",
                    "-f", "lavfi",
                    "-i", &format!("color=c=black:s={canvas_width}x{canvas_height}:r={fps_text}"),
                ],
            );
        }
        video_map = format!("{next_input}:v");
        next_input += 1;
        video_filter = Some(fit.clone());

        if let Some(mic) = microphone {
            push_microphone_input(&mut args, mic);
            audio_inputs.push(next_input);
            next_input += 1;
        }
    } else if let Some(port) = window_port {
        // Window mode: the window's own pixels from the window feeder, already
        // fitted to the canvas and paced to a steady frame rate. Nothing drawn
        // over the window can reach this input.
        push_all(
            &mut args,
            &[
                "-f", "rawvideo",
                "-pix_fmt", windowfeed::pixel_format(),
                "-video_size", &format!("{canvas_width}x{canvas_height}"),
                "-framerate", &fps_text,
                "-thread_queue_size", "512",
                "-i", &format!("tcp://127.0.0.1:{port}"),
            ],
        );
        video_map = format!("{next_input}:v");
        next_input += 1;
        video_filter = Some("setsar=1,format=yuv420p".to_string());

        if let Some(mic) = microphone {
            push_microphone_input(&mut args, mic);
            audio_inputs.push(next_input);
            next_input += 1;
        }
    } else if cfg!(windows) {
        if backend == "ddagrab" {
            // Desktop Duplication: the frames stay on the GPU until hwdownload,
            // which is far cheaper than GDI for the same frame rate.
            push_all(&mut args, &["-init_hw_device", "d3d11va"]);
            filter_parts.push(format!(
                "ddagrab=framerate={fps_text}:draw_mouse=1,hwdownload,format=bgra,{screen_filter}[v]"
            ));
            video_map = "[v]".to_string();
        } else {
            let (grab_x, grab_y, grab_width, grab_height) = (
                config.display_x,
                config.display_y,
                config.display_width,
                config.display_height,
            );
            push_all(
                &mut args,
                &[
                    "-f", "gdigrab",
                    "-framerate", &fps_text,
                    "-draw_mouse", "1",
                    "-offset_x", &grab_x.to_string(),
                    "-offset_y", &grab_y.to_string(),
                    "-video_size", &format!("{grab_width}x{grab_height}"),
                    "-thread_queue_size", "512",
                    "-i", "desktop",
                ],
            );
            video_map = format!("{next_input}:v");
            next_input += 1;
            video_filter = Some(screen_filter.clone());
        }
        if let Some(mic) = microphone {
            push_all(
                &mut args,
                &[
                    "-f", "dshow",
                    "-thread_queue_size", "1024",
                    "-rtbufsize", "64M",
                    "-i", &format!("audio={mic}"),
                ],
            );
            audio_inputs.push(next_input);
            next_input += 1;
        }
    } else {
        let screen = config
            .screen_device_index
            .ok_or("No screen capture device was chosen.")?;
        let mic = microphone.unwrap_or("none");
        push_all(
            &mut args,
            &[
                "-f", "avfoundation",
                "-capture_cursor", "1",
                "-framerate", &fps_text,
                "-thread_queue_size", "512",
                "-i", &format!("{screen}:{mic}"),
            ],
        );
        video_map = format!("{next_input}:v");
        if mic != "none" {
            audio_inputs.push(next_input);
        }
        next_input += 1;
        video_filter = Some(screen_filter.clone());
    }

    if let Some(port) = system_audio_port {
        // Raw PCM from the system-audio feeder (see sysaudio.rs).
        push_all(
            &mut args,
            &[
                "-f", "s16le",
                "-ar", "48000",
                "-ac", "2",
                "-thread_queue_size", "1024",
                "-i", &format!("tcp://127.0.0.1:{port}"),
            ],
        );
        audio_inputs.push(next_input);
        next_input += 1;
    }

    if audio_inputs.is_empty() {
        // Always produce an audio track so every segment has the same streams
        // and the final concat never fails on a mismatch.
        push_all(&mut args, &["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono"]);
        audio_inputs.push(next_input);
    }

    let audio_map = if audio_inputs.len() == 1 {
        format!("{}:a", audio_inputs[0])
    } else {
        let labels: String = audio_inputs.iter().map(|index| format!("[{index}:a]")).collect();
        filter_parts.push(format!(
            "{labels}amix=inputs={}:duration=longest:dropout_transition=0:normalize=0[a]",
            audio_inputs.len()
        ));
        "[a]".to_string()
    };

    if !filter_parts.is_empty() {
        push_all(&mut args, &["-filter_complex", &filter_parts.join(";")]);
    }
    push_all(&mut args, &["-map", &video_map]);
    if let Some(filter) = video_filter {
        push_all(&mut args, &["-vf", &filter]);
    }
    push_all(&mut args, &["-map", &audio_map]);

    let keyframe_interval = (fps * 10).to_string();
    match encoder {
        "h264_nvenc" => push_all(
            &mut args,
            &["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "28", "-b:v", "0", "-maxrate", "2M", "-bufsize", "4M"],
        ),
        "h264_qsv" => push_all(&mut args, &["-c:v", "h264_qsv", "-global_quality", "27"]),
        "h264_amf" => push_all(
            &mut args,
            &["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "25", "-qp_p", "27"],
        ),
        "h264_videotoolbox" => push_all(
            &mut args,
            &["-c:v", "h264_videotoolbox", "-b:v", "1000k", "-maxrate", "1600k", "-realtime", "1"],
        ),
        _ => push_all(
            &mut args,
            &["-c:v", "libx264", "-preset", "superfast", "-crf", "26"],
        ),
    }
    push_all(&mut args, &["-pix_fmt", "yuv420p", "-g", &keyframe_interval]);
    push_all(&mut args, &["-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "48000"]);
    // Live capture and looped pictures have different native time bases.
    // The concat demuxer requires the same time base in every segment.
    push_all(&mut args, &["-video_track_timescale", "90000"]);
    push_all(
        &mut args,
        &[
            "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
            "-f", "mp4",
            &config.output_path,
        ],
    );
    Ok(args)
}

#[tauri::command]
pub async fn start_capture(app: AppHandle, config: CaptureConfig) -> Result<CaptureStarted, String> {
    // Off the main thread: window mode waits for the window's first frame,
    // and that must never freeze the recorder's own windows.
    tauri::async_runtime::spawn_blocking(move || start_capture_blocking(app, config))
        .await
        .map_err(|e| e.to_string())?
}

fn start_capture_blocking(app: AppHandle, config: CaptureConfig) -> Result<CaptureStarted, String> {
    let state = app.state::<AppState>();
    if state
        .capture
        .lock()
        .map_err(|_| "capture state is poisoned")?
        .is_some()
    {
        return Err("A capture is already running.".into());
    }
    let ffmpeg = sidecar_path("ffmpeg")?;
    let mut warnings = Vec::new();

    let fps = config.fps.unwrap_or(10).clamp(5, 30);
    let target_height = target_height_for(config.display_height);

    // Window mode: capture the window on its own before anything else starts,
    // so a window the system will not capture fails the whole start cleanly
    // (the recorder then freezes the picture — it never falls back to cropping
    // the screen).
    let window_feed = match config
        .window_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(window_id) if config.still_path.is_none() => {
            let (canvas_width, canvas_height) = canvas_for(&config, target_height);
            Some(
                windowfeed::WindowFeed::start(window_id, canvas_width, canvas_height, fps)
                    .map_err(|err| format!("This window cannot be captured on its own: {err}"))?,
            )
        }
        _ => None,
    };
    let window_port = window_feed.as_ref().map(|feed| feed.port());

    // The system-audio feeder listens first so ffmpeg can connect to it.
    let mut system_audio_port: Option<u16> = None;
    if config.system_audio {
        match sysaudio::SystemAudioFeeder::start(config.output_device_id.clone()) {
            Ok(feeder) => {
                system_audio_port = Some(feeder.port());
                *state
                    .system_audio
                    .lock()
                    .map_err(|_| "system audio state is poisoned")? = Some(feeder);
            }
            Err(err) => warnings.push(format!("System audio is not being recorded: {err}")),
        }
    }

    let backend = match window_feed.as_ref() {
        Some(feed) => feed.backend().to_string(),
        None => config
            .backend
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| default_backend(&config)),
    };
    let encoder = config
        .encoder
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "libx264".to_string());
    let args = build_args(
        &config,
        &backend,
        &encoder,
        fps,
        target_height,
        system_audio_port,
        window_port,
    )?;

    if let Some(parent) = Path::new(&config.output_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let stderr_tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
    let mut child = command(&ffmpeg)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start ffmpeg: {err}"))?;
    if let Some(stderr) = child.stderr.take() {
        let tail = stderr_tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut tail) = tail.lock() {
                    tail.push_back(line);
                    while tail.len() > 40 {
                        tail.pop_front();
                    }
                }
            }
        });
    }

    *state
        .window_feed
        .lock()
        .map_err(|_| "window capture state is poisoned")? = window_feed;
    *state
        .capture
        .lock()
        .map_err(|_| "capture state is poisoned")? = Some(CaptureSession {
        child,
        started_at: Instant::now(),
        output_path: PathBuf::from(&config.output_path),
        stderr_tail,
        backend: backend.clone(),
        encoder: encoder.clone(),
    });

    Ok(CaptureStarted {
        backend,
        encoder,
        system_audio: system_audio_port.is_some(),
        warnings,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStopped {
    pub seconds: f64,
    pub size_bytes: u64,
    pub output_path: String,
}

#[tauri::command]
pub async fn stop_capture(app: AppHandle) -> Result<CaptureStopped, String> {
    // ffmpeg shutdown and joining the audio worker must never block Cocoa's
    // main thread (or the Windows WebView message loop).
    tauri::async_runtime::spawn_blocking(move || stop_capture_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn stop_capture_blocking(app: AppHandle) -> Result<CaptureStopped, String> {
    let state = app.state::<AppState>();
    let session = state
        .capture
        .lock()
        .map_err(|_| "capture state is poisoned")?
        .take();
    let feeder = state.system_audio.lock()
        .map_err(|_| "system audio state is poisoned")?.take();
    let window_feed = state.window_feed.lock()
        .map_err(|_| "window capture state is poisoned")?.take();
    let mut result = CaptureStopped {
        seconds: 0.0,
        size_bytes: 0,
        output_path: String::new(),
    };
    let mut stop_result = Ok(());
    if let Some(mut session) = session {
        result.seconds = session.started_at.elapsed().as_secs_f64();
        stop_result = session.stop();
        result.output_path = session.output_path.to_string_lossy().to_string();
        result.size_bytes = std::fs::metadata(&session.output_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
    }
    // ffmpeg is gone; now the feeders may stop too. (In that order: ffmpeg
    // closing its end is what ends the window feeder's writes.)
    if let Some(mut feeder) = feeder {
        feeder.stop();
    }
    if let Some(mut window_feed) = window_feed {
        window_feed.stop();
    }
    stop_result?;
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub running: bool,
    pub exited: bool,
    pub exit_code: Option<i32>,
    pub seconds: f64,
    pub backend: String,
    pub encoder: String,
    pub stderr_tail: Vec<String>,
}

#[tauri::command]
pub fn capture_status(app: AppHandle) -> Result<CaptureStatus, String> {
    let state = app.state::<AppState>();
    let mut guard = state
        .capture
        .lock()
        .map_err(|_| "capture state is poisoned")?;
    let Some(session) = guard.as_mut() else {
        return Ok(CaptureStatus {
            running: false,
            exited: false,
            exit_code: None,
            seconds: 0.0,
            backend: String::new(),
            encoder: String::new(),
            stderr_tail: vec![],
        });
    };
    let seconds = session.started_at.elapsed().as_secs_f64();
    match session.child.try_wait() {
        Ok(Some(status)) => Ok(CaptureStatus {
            running: false,
            exited: true,
            exit_code: status.code(),
            seconds,
            backend: session.backend.clone(),
            encoder: session.encoder.clone(),
            stderr_tail: session.stderr_lines(),
        }),
        Ok(None) => Ok(CaptureStatus {
            running: true,
            exited: false,
            exit_code: None,
            seconds,
            backend: session.backend.clone(),
            encoder: session.encoder.clone(),
            stderr_tail: session.stderr_lines(),
        }),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub async fn concat_segments(
    app: AppHandle,
    segments: Vec<String>,
    output: String,
    expected_seconds: Option<f64>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress_output = output.clone();
        let progress_app = app.clone();
        concat_blocking(
            segments,
            output,
            expected_seconds,
            |progress| {
                let _ = progress_app.emit("preparation-progress", serde_json::json!({
                    "outputPath": progress_output, "elapsedSeconds": progress.elapsed_seconds,
                    "idleSeconds": progress.idle_seconds, "processedSeconds": progress.processed_seconds,
                    "sizeBytes": progress.size_bytes,
                }));
            },
        )
    })
        .await
        .map_err(|e| e.to_string())?
}

/// The "Duration: HH:MM:SS.ss" ffmpeg prints for an input, in seconds.
pub fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    let start = stderr.find("Duration: ")? + "Duration: ".len();
    let text: String = stderr[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == ':' || *c == '.')
        .collect();
    let mut parts = text.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn probe_duration(ffmpeg: &Path, path: &Path) -> Result<f64, String> {
    // ffmpeg exits with no output specified after inspecting the input. Bound
    // this probe too, so checking the result cannot reintroduce a finishing hang.
    let mut child = command(ffmpeg)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(path)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped())
        .spawn().map_err(|e| e.to_string())?;
    let stderr = child.stderr.take().ok_or("No duration probe output")?;
    let reader = std::thread::spawn(move || {
        let mut duration = None;
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if duration.is_none() { duration = parse_ffmpeg_duration(&line); }
        }
        duration
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    let result = loop {
        match child.try_wait() {
            Ok(Some(_)) => break Ok(()),
            Err(error) => break Err(error.to_string()),
            Ok(None) if Instant::now() >= deadline => break Err("Checking the recording duration timed out.".into()),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    };
    if result.is_err() { let _ = child.kill(); }
    let _ = child.wait();
    let duration = reader.join().ok().flatten();
    result?;
    duration.ok_or_else(|| "Could not verify the prepared recording's duration. Original segments have been kept.".into())
}

/// A broad sanity check, not a reason to invent replacement timestamps.
/// Startup gaps are expected, but hours of extra video or a severely shortened
/// class must not be published as a successful recording.
pub fn plausible_duration(actual_seconds: f64, expected_seconds: f64) -> bool {
    if !(expected_seconds.is_finite() && expected_seconds > 0.0) { return true; }
    actual_seconds.is_finite() && actual_seconds > 0.0
        && actual_seconds <= expected_seconds * 1.25 + 300.0
        && actual_seconds >= expected_seconds * 0.5 - 60.0
}

/// Copy each segment into a common MP4 video time base before concatenation.
/// This also repairs old live/still segments. Do not regenerate timestamps
/// from frame counts: AVFoundation can drop frames, and that would speed up
/// the picture and desynchronize it from audio.
fn concat_blocking(
    segments: Vec<String>,
    output: String,
    expected_seconds: Option<f64>,
    mut report: impl FnMut(crate::preparation::Progress),
) -> Result<u64, String> {
    if segments.is_empty() { return Err("There are no segments to combine.".into()); }
    let ffmpeg = sidecar_path("ffmpeg")?;
    let work_dir = PathBuf::from(&output).with_extension("normalizing");
    // Only preparation scratch space is removed, never an original segment.
    if work_dir.exists() {
        std::fs::remove_dir_all(&work_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;
    let result = concat_normalized(&ffmpeg, &segments, &output, expected_seconds, &work_dir, &mut report);
    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| item.to_string()).collect()
}

fn write_concat_list(list_path: &Path, files: &[String]) -> Result<(), String> {
    let mut list = String::new();
    for file in files {
        let escaped = file.replace('\\', "/").replace('\'', "'\\''");
        list.push_str(&format!("file '{escaped}'\n"));
    }
    std::fs::write(list_path, list).map_err(|e| e.to_string())
}

/// All destinations here are disposable scratch files. Publishing over a
/// previous prepared recording happens only after the entire join validates.
fn run_preparation(
    ffmpeg: &Path,
    args: &[String],
    output: &Path,
    report: &mut impl FnMut(crate::preparation::Progress),
) -> Result<u64, String> {
    let mut child = command(ffmpeg)
        .args(["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
            "-nostats", "-stats_period", "1", "-progress", "pipe:1"])
        .args(args).arg(output)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    crate::preparation::wait(&mut child, output, Duration::from_secs(120), report)?;
    let size = std::fs::metadata(output).map_err(|e| e.to_string())?.len();
    if size == 0 {
        return Err("Preparing the recording produced an empty file. Original segments have been kept.".into());
    }
    Ok(size)
}

fn concat_normalized(
    ffmpeg: &Path,
    segments: &[String],
    output: &str,
    expected_seconds: Option<f64>,
    work_dir: &Path,
    report: &mut impl FnMut(crate::preparation::Progress),
) -> Result<u64, String> {
    let started = Instant::now();
    let mut done_bytes = 0u64;
    let mut parts = Vec::with_capacity(segments.len());
    for (index, segment) in segments.iter().enumerate() {
        let part = work_dir.join(format!("part-{index:04}.mp4"));
        let args = strings(&[
            "-i", segment, "-map", "0:v:0", "-map", "0:a:0?",
            "-c", "copy", "-video_track_timescale", "90000", "-f", "mp4",
        ]);
        let size = run_preparation(ffmpeg, &args, &part, &mut |progress| {
            report(crate::preparation::Progress {
                elapsed_seconds: started.elapsed().as_secs(),
                size_bytes: done_bytes + progress.size_bytes,
                ..progress
            });
        }).map_err(|error| format!("Preparing segment {} of {}: {error}", index + 1, segments.len()))?;
        done_bytes += size;
        parts.push(part.to_string_lossy().to_string());
    }
    let list_path = work_dir.join("list.txt");
    write_concat_list(&list_path, &parts)?;
    let list_arg = list_path.to_string_lossy().to_string();
    let candidate = work_dir.join("recording.mp4");
    let args = strings(&[
        "-f", "concat", "-safe", "0", "-i", &list_arg,
        "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
        "-video_track_timescale", "90000", "-movflags", "+faststart", "-f", "mp4",
    ]);
    let size = run_preparation(ffmpeg, &args, &candidate, &mut |progress| {
        report(crate::preparation::Progress {
            elapsed_seconds: started.elapsed().as_secs(),
            size_bytes: done_bytes + progress.size_bytes,
            ..progress
        });
    })?;
    let duration = probe_duration(ffmpeg, &candidate)?;
    if let Some(expected) = expected_seconds {
        if !plausible_duration(duration, expected) {
            return Err(format!(
                "The prepared recording's duration ({duration:.1} s) does not match the saved recording time ({expected:.1} s). Original segments have been kept."
            ));
        }
    }
    std::fs::rename(&candidate, output)
        .map_err(|e| format!("Could not save the prepared recording: {e}"))?;
    Ok(size)
}

#[cfg(test)]
mod preparation_tests {
    use super::*;

    #[test]
    fn combines_all_frames_and_preserves_originals_when_a_later_segment_is_invalid() {
        let ffmpeg = sidecar_path("ffmpeg").unwrap();
        let dir = std::env::temp_dir().join(format!("recorder-concat-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("first.mp4");
        let second = dir.join("second.mp4");
        let output = dir.join("recording.mp4");
        let generated = command(&ffmpeg).args([
            "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10", "-t", "0.5",
            "-an", "-c:v", "libx264", "-g", "1",
            "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
        ]).arg(&first).output().unwrap();
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
        std::fs::copy(&first, &second).unwrap();
        let segments = vec![first.to_string_lossy().to_string(), second.to_string_lossy().to_string()];
        concat_blocking(segments.clone(), output.to_string_lossy().to_string(), None, |_| {}).unwrap();
        let decoded = command(&ffmpeg).args(["-v", "error", "-i"]).arg(&output)
            .args(["-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"]).output().unwrap();
        assert!(decoded.status.success());
        let frame_count = String::from_utf8_lossy(&decoded.stdout).lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#')).count();
        assert_eq!(frame_count, 10, "both five-frame segments must be included");
        let prepared = std::fs::read(&output).unwrap();
        let original = std::fs::read(&first).unwrap();
        std::fs::write(&second, b"invalid segment").unwrap();
        let result = concat_blocking(segments, output.to_string_lossy().to_string(), None, |_| {});
        assert!(result.is_err(), "a broken later segment must not silently publish only the first one");
        assert_eq!(std::fs::read(&first).unwrap(), original);
        assert_eq!(std::fs::read(&second).unwrap(), b"invalid segment");
        assert_eq!(std::fs::read(&output).unwrap(), prepared);
        for file in std::fs::read_dir(&dir).unwrap() {
            std::fs::remove_file(file.unwrap().path()).unwrap();
        }
        std::fs::remove_dir(dir).unwrap();
    }

    fn mixed_segments(dir: &Path, scales: &[&str], variable_rate: bool) -> Vec<String> {
        let ffmpeg = sidecar_path("ffmpeg").unwrap();
        let mut paths = Vec::new();
        for (index, scale) in scales.iter().enumerate() {
            let path = dir.join(format!("seg-{index}.mp4"));
            let mut args = strings(&[
                "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "testsrc2=s=64x64:r=10:d=3",
                "-f", "lavfi", "-i", "sine=f=440:r=48000:d=3",
                "-map", "0:v", "-map", "1:a",
                "-c:v", "libx264", "-bf", if variable_rate { "0" } else { "2" }, "-c:a", "aac", "-ac", "1",
                "-video_track_timescale", scale,
                "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
            ]);
            if variable_rate {
                args.extend(strings(&["-vf", "select=not(mod(n\\,3))", "-fps_mode", "vfr"]));
            }
            let generated = command(&ffmpeg).args(&args).arg(&path).output().unwrap();
            assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
            paths.push(path.to_string_lossy().to_string());
        }
        paths
    }

    fn media_frames(ffmpeg: &Path, path: &str, stream: &str) -> Vec<(i64, String)> {
        let mut cmd = command(ffmpeg);
        cmd.args(["-v", "error", "-i", path, "-map", stream]);
        if stream == "0:v:0" {
            // Concat adds H.264 parameter sets at segment boundaries. Compare
            // decoded pixels, not those harmless encoded header differences.
            cmd.args(["-c:v", "rawvideo", "-fps_mode", "passthrough", "-enc_time_base", "1:90000"]);
        } else {
            cmd.args(["-c", "copy"]);
        }
        let packets = cmd.args(["-f", "framecrc", "-"]).output().unwrap();
        assert!(packets.status.success(), "{}", String::from_utf8_lossy(&packets.stderr));
        String::from_utf8_lossy(&packets.stdout).lines()
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|line| {
                let fields: Vec<_> = line.split(',').map(str::trim).collect();
                (fields[2].parse().unwrap(), fields[5].to_string())
            }).collect()
    }

    #[test]
    fn joins_mixed_live_and_frozen_time_bases_without_changing_media() {
        let ffmpeg = sidecar_path("ffmpeg").unwrap();
        let dir = std::env::temp_dir().join(format!("recorder-timescale-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // Both switching directions, plus variable-rate capture: rebuilding
        // timestamps as N/fps would compress these dropped-frame segments.
        for (scales, variable) in [
            (["10240", "1000000", "10240"], false),
            (["1000000", "10240", "1000000"], true),
        ] {
            let segments = mixed_segments(&dir, &scales, variable);
            let originals: Vec<_> = segments.iter().map(|p| std::fs::read(p).unwrap()).collect();
            let output = dir.join("recording.mp4");
            let output_text = output.to_string_lossy().to_string();

            if !variable {
                let list = dir.join("old-list.txt");
                write_concat_list(&list, &segments).unwrap();
                let failed = command(&ffmpeg).args(["-y", "-v", "error", "-xerror",
                    "-f", "concat", "-safe", "0", "-i"]).arg(&list)
                    .args(["-c", "copy"]).arg(dir.join("broken.mp4")).output().unwrap();
                assert!(!failed.status.success(), "the old path must reproduce the reported failure");
                assert!(String::from_utf8_lossy(&failed.stderr).contains("Non-monotonic DTS"));
            }

            concat_blocking(segments.clone(), output_text.clone(), Some(9.0), |_| {}).unwrap();
            let length = probe_duration(&ffmpeg, &output).unwrap();
            // Fragmented MP4 includes the encoder's initial reorder/priming
            // delay; preserve it rather than treating it as corrupted timing.
            let expected_length: f64 = segments.iter()
                .map(|path| probe_duration(&ffmpeg, Path::new(path)).unwrap()).sum();
            assert!((length - expected_length).abs() < 0.1,
                "{expected_length} s of media, not {length} s");
            for stream in ["0:v:0", "0:a:0"] {
                let joined = media_frames(&ffmpeg, &output_text, stream);
                let mut offset = 0;
                for segment in &segments {
                    let original = media_frames(&ffmpeg, segment, stream);
                    let slice = &joined[offset..offset + original.len()];
                    for (before, after) in original.iter().zip(slice) {
                        assert_eq!(before.1, after.1, "video pixels/audio packets must survive in order");
                        // Allow one time-base rounding tick, not frame-count
                        // retiming, which loses the variable-rate spacing.
                        let delta = (before.0 - original[0].0) - (after.0 - slice[0].0);
                        assert!(delta.abs() <= 1, "frame spacing changed by {delta} ticks");
                    }
                    offset += original.len();
                }
                assert_eq!(joined.len(), offset, "no dropped or duplicated media");
            }
            for (segment, bytes) in segments.iter().zip(&originals) {
                assert_eq!(&std::fs::read(segment).unwrap(), bytes);
            }
            assert!(!output.with_extension("normalizing").exists());

            // A plausible-length check must also preserve any existing final.
            let prepared = std::fs::read(&output).unwrap();
            assert!(concat_blocking(segments, output_text, Some(7200.0), |_| {}).is_err());
            assert_eq!(std::fs::read(&output).unwrap(), prepared);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_the_duration_ffmpeg_prints() {
        assert_eq!(parse_ffmpeg_duration("Duration: 05:00:03.02, start: 0.000000"), Some(18003.02));
        assert_eq!(parse_ffmpeg_duration("Duration: 00:25:16.40, start"), Some(1516.4));
        assert_eq!(parse_ffmpeg_duration("Duration: N/A, bitrate"), None);
        assert!(!plausible_duration(18000.0, 1516.0));
        assert!(plausible_duration(1350.0, 1516.0));
        assert!(!plausible_duration(10.0, 3600.0));
    }
}

/// Pull the last frame of a finished segment out as a JPEG, for the frozen
/// picture shown while the tutor is on a window they did not share.
///
/// Taken from the file rather than from the screen on purpose: by the time we
/// notice the focus change, the window that took focus may already be covering
/// the one we were recording, and grabbing the screen would capture exactly
/// what the tutor asked us not to show.
#[tauri::command]
pub async fn extract_last_frame(segment: String, output: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || extract_last_frame_blocking(segment, output))
        .await
        .map_err(|e| e.to_string())?
}

fn extract_last_frame_blocking(segment: String, output: String) -> Result<(), String> {
    let ffmpeg = sidecar_path("ffmpeg")?;
    let _ = std::fs::remove_file(&output);

    // Seeking from the end is cheap; a segment shorter than that seek produces
    // nothing, so fall back to decoding it and keeping the last frame written.
    let attempts: [Vec<&str>; 2] = [
        vec![
            "-y", "-hide_banner", "-loglevel", "error",
            "-sseof", "-1.5", "-i", &segment,
            // No frame limit: -update rewrites the same file for every frame,
            // so what survives is the last one.
            "-update", "1", "-q:v", "3", &output,
        ],
        vec![
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", &segment,
            "-update", "1", "-q:v", "3", &output,
        ],
    ];

    let mut last_error = String::new();
    for args in attempts {
        let result = command(&ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output();
        match result {
            Ok(done) => {
                let wrote = std::fs::metadata(&output).map(|meta| meta.len()).unwrap_or(0);
                if done.status.success() && wrote > 0 {
                    return Ok(());
                }
                last_error = String::from_utf8_lossy(&done.stderr).trim().to_string();
            }
            Err(err) => last_error = err.to_string(),
        }
        let _ = std::fs::remove_file(&output);
    }
    Err(if last_error.is_empty() {
        "ffmpeg produced no still frame.".to_string()
    } else {
        last_error
    })
}
