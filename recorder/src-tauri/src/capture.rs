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
use tauri::{AppHandle, Manager};

use crate::{sysaudio, AppState};

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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStarted {
    pub backend: String,
    pub encoder: String,
    pub system_audio: bool,
    pub warnings: Vec<String>,
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

fn build_args(
    config: &CaptureConfig,
    backend: &str,
    encoder: &str,
    fps: u32,
    target_height: Option<u32>,
    system_audio_port: Option<u16>,
) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = Vec::new();
    push_all(&mut args, &["-y", "-hide_banner", "-loglevel", "warning", "-nostats"]);

    let scale_filter = target_height
        .map(|height| format!("scale=-2:{height},"))
        .unwrap_or_default();
    let fps_text = fps.to_string();

    let mut filter_parts: Vec<String> = Vec::new();
    let mut next_input = 0usize;
    let mut audio_inputs: Vec<usize> = Vec::new();
    let video_map: String;
    // Applied with -vf when the video comes from a real input (not a filter source).
    let mut video_filter: Option<String> = None;

    if cfg!(windows) {
        if backend == "ddagrab" {
            // Desktop Duplication: the frames stay on the GPU until hwdownload,
            // which is far cheaper than GDI for the same frame rate.
            push_all(&mut args, &["-init_hw_device", "d3d11va"]);
            filter_parts.push(format!(
                "ddagrab=framerate={fps_text}:draw_mouse=1,hwdownload,format=bgra,{scale_filter}format=yuv420p[v]"
            ));
            video_map = "[v]".to_string();
        } else {
            push_all(
                &mut args,
                &[
                    "-f", "gdigrab",
                    "-framerate", &fps_text,
                    "-draw_mouse", "1",
                    "-offset_x", &config.display_x.to_string(),
                    "-offset_y", &config.display_y.to_string(),
                    "-video_size", &format!("{}x{}", config.display_width, config.display_height),
                    "-thread_queue_size", "512",
                    "-i", "desktop",
                ],
            );
            video_map = format!("{next_input}:v");
            next_input += 1;
            video_filter = Some(format!("{scale_filter}format=yuv420p"));
        }
        if let Some(mic) = config.microphone_id.as_deref().filter(|id| !id.is_empty()) {
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
        let mic = config
            .microphone_id
            .clone()
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| "none".to_string());
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
        video_filter = Some(format!("{scale_filter}format=yuv420p"));
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
pub fn start_capture(app: AppHandle, config: CaptureConfig) -> Result<CaptureStarted, String> {
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

    let fps = config.fps.unwrap_or(10).clamp(5, 30);
    let target_height = target_height_for(config.display_height);
    let backend = config
        .backend
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_backend(&config));
    let encoder = config
        .encoder
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "libx264".to_string());
    let args = build_args(&config, &backend, &encoder, fps, target_height, system_audio_port)?;

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
pub fn stop_capture(app: AppHandle) -> Result<CaptureStopped, String> {
    let state = app.state::<AppState>();
    let session = state
        .capture
        .lock()
        .map_err(|_| "capture state is poisoned")?
        .take();
    let mut result = CaptureStopped {
        seconds: 0.0,
        size_bytes: 0,
        output_path: String::new(),
    };
    if let Some(mut session) = session {
        result.seconds = session.started_at.elapsed().as_secs_f64();
        session.stop()?;
        result.output_path = session.output_path.to_string_lossy().to_string();
        result.size_bytes = std::fs::metadata(&session.output_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
    }
    // ffmpeg is gone; now the feeder may stop too.
    if let Ok(mut guard) = state.system_audio.lock() {
        if let Some(mut feeder) = guard.take() {
            feeder.stop();
        }
    }
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
pub async fn concat_segments(segments: Vec<String>, output: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || concat_blocking(segments, output))
        .await
        .map_err(|e| e.to_string())?
}

/// Stitch fragmented-MP4 segments into one normal MP4 (stream copy, faststart).
fn concat_blocking(segments: Vec<String>, output: String) -> Result<u64, String> {
    if segments.is_empty() {
        return Err("There are no segments to combine.".into());
    }
    let ffmpeg = sidecar_path("ffmpeg")?;
    let list_path = PathBuf::from(&output).with_extension("txt");
    let mut list = String::new();
    for segment in &segments {
        let escaped = segment.replace('\\', "/").replace('\'', "'\\''");
        list.push_str(&format!("file '{escaped}'\n"));
    }
    std::fs::write(&list_path, list).map_err(|e| e.to_string())?;
    let list_arg = list_path.to_string_lossy().to_string();
    let output_result = command(&ffmpeg)
        .args([
            "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0",
            "-i", &list_arg,
            "-c", "copy",
            "-movflags", "+faststart",
            &output,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output();
    let _ = std::fs::remove_file(&list_path);
    let output_result = output_result.map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    if !output_result.status.success() {
        return Err(format!(
            "ffmpeg could not combine the segments: {}",
            String::from_utf8_lossy(&output_result.stderr).trim()
        ));
    }
    std::fs::metadata(&output)
        .map(|meta| meta.len())
        .map_err(|e| e.to_string())
}
