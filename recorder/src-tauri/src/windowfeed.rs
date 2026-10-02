//! Window mode: record one window's own pixels, never the screen around it.
//!
//! Cropping a screen capture to a window's rectangle records whatever is drawn
//! over that rectangle — a notification, a chat popping up, another window —
//! which is exactly what sharing a window instead of the screen is meant to
//! prevent. So the window is captured on its own:
//!
//!  * Windows — Windows.Graphics.Capture, through ffmpeg's `gfxcapture` source
//!    on the window's HWND.
//!  * macOS — ScreenCaptureKit with a single-window filter, through the
//!    bundled `wincapture` helper (`recorder/wincapture/main.swift`).
//!
//! Both only produce a frame when the window changes, and a window showing a
//! slide can go minutes without one. Fed straight to the encoder that stalls
//! it — and the live microphone with it. So frames go through a pacer: the
//! latest frame is kept and written to the encoder at a steady rate over a
//! local socket, repeated while the window is still. Every frame arrives
//! already scaled and centred onto the class's fixed canvas.

use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How long a window gets to deliver its first frame before we give up on it.
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(6);

/// The raw pixel format on the socket, as ffmpeg names it.
pub fn pixel_format() -> &'static str {
    if cfg!(target_os = "macos") {
        // ScreenCaptureKit hands over BGRA; converting in the helper would
        // only move the work.
        "bgra"
    } else {
        // Converted inside the producer ffmpeg: less than half the bytes of BGRA.
        "yuv420p"
    }
}

/// Bytes in one frame of `pixel_format()` at this size.
pub fn frame_bytes(width: u32, height: u32) -> usize {
    let pixels = width as usize * height as usize;
    if cfg!(target_os = "macos") {
        pixels * 4
    } else {
        pixels * 3 / 2
    }
}

/// How many frames should have been written `elapsed` after the start, at
/// `fps`: the first straight away, then one per frame interval. Keeping the
/// count tied to the clock — not to how often the window changes — is what
/// keeps the picture in step with the audio.
pub fn frames_due(elapsed: Duration, fps: u32) -> u64 {
    (elapsed.as_secs_f64() * fps.max(1) as f64).floor() as u64 + 1
}

/// Window ids are HWNDs (Windows) and CGWindowIDs (macOS): plain numbers. They
/// end up inside an ffmpeg filter string, so nothing else is accepted.
pub fn parse_window_id(id: &str) -> Result<u64, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("\"{id}\" is not a window id."));
    }
    trimmed
        .parse::<u64>()
        .ok()
        .filter(|value| *value != 0)
        .ok_or_else(|| format!("\"{id}\" is not a window id."))
}

/// The producer ffmpeg on Windows: the window through Windows.Graphics.Capture,
/// scaled to fit the canvas and centred, as raw frames on stdout. `resize_mode`
/// keeps a window resized mid-segment in proportion until the recorder starts
/// a fresh segment for its new shape.
pub fn windows_producer_args(hwnd: u64, width: u32, height: u32, fps: u32) -> Vec<String> {
    let graph = format!(
        "gfxcapture=hwnd={hwnd}:max_framerate={fps}:capture_cursor=1:resize_mode=scale_aspect,\
hwdownload,format=bgra,\
scale={width}:{height}:force_original_aspect_ratio=decrease,\
pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
    );
    [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-init_hw_device", "d3d11va",
        "-filter_complex", &graph,
        "-f", "rawvideo", "pipe:1",
    ]
    .iter()
    .map(|item| item.to_string())
    .collect()
}

/// The macOS helper's arguments (see wincapture/main.swift).
pub fn macos_producer_args(window_id: u64, width: u32, height: u32, fps: u32) -> Vec<String> {
    vec![
        "--window".into(),
        window_id.to_string(),
        "--width".into(),
        width.to_string(),
        "--height".into(),
        height.to_string(),
        "--fps".into(),
        fps.to_string(),
    ]
}

pub struct WindowFeed {
    port: u16,
    backend: &'static str,
    stop: Arc<AtomicBool>,
    producer: Arc<Mutex<Option<Child>>>,
    /// Held open for the macOS helper, which exits when its stdin closes.
    _producer_stdin: Option<ChildStdin>,
    threads: Vec<JoinHandle<()>>,
}

impl WindowFeed {
    /// Start capturing `window_id` onto a `width`×`height` canvas. Returns once
    /// the window has delivered its first frame, so a window the system will
    /// not capture (elevated, protected, already closed) fails here rather than
    /// recording black.
    pub fn start(window_id: &str, width: u32, height: u32, fps: u32) -> Result<Self, String> {
        let id = parse_window_id(window_id)?;
        let fps = fps.clamp(1, 60);
        let frame_size = frame_bytes(width, height);
        if frame_size == 0 {
            return Err("The recording canvas has no size.".into());
        }

        let (program, args, backend) = if cfg!(windows) {
            (
                crate::capture::sidecar_path("ffmpeg")?,
                windows_producer_args(id, width, height, fps),
                "gfxcapture",
            )
        } else if cfg!(target_os = "macos") {
            (
                crate::capture::sidecar_path("wincapture")?,
                macos_producer_args(id, width, height, fps),
                "screencapturekit",
            )
        } else {
            return Err("Recording a single window is not supported on this platform.".into());
        };

        let mut child = crate::capture::command(&program)
            .args(&args)
            .stdin(if cfg!(target_os = "macos") { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start window capture: {e}"))?;
        let producer_stdin = child.stdin.take();
        let mut stdout = child.stdout.take().ok_or("window capture has no stdout")?;
        let stderr = child.stderr.take();
        let producer = Arc::new(Mutex::new(Some(child)));

        let stop = Arc::new(AtomicBool::new(false));
        let latest: Arc<Mutex<Arc<Vec<u8>>>> = Arc::new(Mutex::new(Arc::new(Vec::new())));
        let received = Arc::new(AtomicU64::new(0));
        let producer_done = Arc::new(AtomicBool::new(false));
        let errors = Arc::new(Mutex::new(String::new()));
        let mut threads = Vec::new();

        // Why a window could not be captured, for the tutor's log.
        if let Some(stderr) = stderr {
            let errors = errors.clone();
            threads.push(std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if let Ok(mut text) = errors.lock() {
                        if text.len() < 2000 {
                            text.push_str(line.trim());
                            text.push(' ');
                        }
                    }
                }
            }));
        }

        // Reader: keep only the newest whole frame.
        {
            let latest = latest.clone();
            let received = received.clone();
            let producer_done = producer_done.clone();
            threads.push(std::thread::spawn(move || {
                let mut frame = vec![0u8; frame_size];
                while stdout.read_exact(&mut frame).is_ok() {
                    if let Ok(mut slot) = latest.lock() {
                        *slot = Arc::new(frame.clone());
                    }
                    received.fetch_add(1, Ordering::SeqCst);
                }
                producer_done.store(true, Ordering::SeqCst);
            }));
        }

        let mut feed = Self {
            port: 0,
            backend,
            stop: stop.clone(),
            producer: producer.clone(),
            _producer_stdin: producer_stdin,
            threads,
        };

        // Wait for the first frame: proof the system is capturing this window.
        let deadline = Instant::now() + FIRST_FRAME_TIMEOUT;
        while received.load(Ordering::SeqCst) == 0 {
            if producer_done.load(Ordering::SeqCst) || Instant::now() > deadline {
                feed.stop();
                let detail = errors.lock().map(|text| text.trim().to_string()).unwrap_or_default();
                return Err(if detail.is_empty() {
                    "the system did not deliver a picture of this window".into()
                } else {
                    detail
                });
            }
            std::thread::sleep(Duration::from_millis(20));
        }

        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        feed.port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        feed.threads.push(std::thread::spawn(move || {
            let Some(stream) =
                crate::sysaudio::accept_with_timeout(&listener, &stop, Duration::from_secs(20))
            else {
                return;
            };
            pace(stream, latest, fps, stop);
        }));
        Ok(feed)
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// "gfxcapture" or "screencapturekit", for the log.
    pub fn backend(&self) -> &'static str {
        self.backend
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.producer.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        self._producer_stdin = None;
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

impl Drop for WindowFeed {
    fn drop(&mut self) {
        // Never leave a capture helper running behind a failed start.
        self.stop.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.producer.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Write the newest frame to the encoder in step with the clock until it
/// disconnects or we are stopped.
fn pace(stream: TcpStream, latest: Arc<Mutex<Arc<Vec<u8>>>>, fps: u32, stop: Arc<AtomicBool>) {
    let mut stream = stream;
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_nodelay(true);
    // Blocking writes, no timeout: a Winsock send that times out leaves the
    // socket in an undefined state, which a video stream cannot survive. Stop
    // does not need one either — the encoder is always stopped first, which
    // closes the socket and ends any write in progress.
    let interval = Duration::from_secs_f64(1.0 / fps.max(1) as f64);
    let started = Instant::now();
    let mut written: u64 = 0;
    while !stop.load(Ordering::SeqCst) {
        while written < frames_due(started.elapsed(), fps) {
            let frame = match latest.lock() {
                Ok(slot) => slot.clone(),
                Err(_) => return,
            };
            if !write_frame(&mut stream, &frame, &stop) {
                return;
            }
            written += 1;
        }
        std::thread::sleep(interval / 2);
    }
}

/// Write one whole frame. An interrupted write resumes the same frame rather
/// than dropping it: a half-written frame would misalign every frame after it.
fn write_frame(stream: &mut TcpStream, frame: &[u8], stop: &AtomicBool) -> bool {
    let mut offset = 0;
    while offset < frame.len() {
        match stream.write(&frame[offset..]) {
            Ok(0) => return false,
            Ok(count) => offset += count,
            Err(err) if err.kind() == ErrorKind::Interrupted => {
                if stop.load(Ordering::SeqCst) {
                    return false;
                }
            }
            // The encoder hung up: the segment is over.
            Err(_) => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_frame_is_due_at_once_then_one_per_interval() {
        assert_eq!(frames_due(Duration::ZERO, 30), 1);
        assert_eq!(frames_due(Duration::from_millis(33), 30), 1);
        assert_eq!(frames_due(Duration::from_millis(34), 30), 2);
        assert_eq!(frames_due(Duration::from_secs(10), 30), 301);
    }

    #[test]
    fn frames_keep_up_with_the_clock_however_rarely_the_window_changes() {
        // The whole point: a still window for a minute is still a minute of video.
        assert_eq!(frames_due(Duration::from_secs(60), 10), 601);
    }

    #[test]
    fn window_ids_are_numbers_only() {
        assert_eq!(parse_window_id("590698"), Ok(590698));
        assert_eq!(parse_window_id(" 42 "), Ok(42));
        assert!(parse_window_id("").is_err());
        assert!(parse_window_id("0").is_err());
        assert!(parse_window_id("12:hwnd=3").is_err());
        assert!(parse_window_id("-5").is_err());
        assert!(parse_window_id("abc").is_err());
    }

    #[test]
    fn windows_producer_captures_the_window_itself_not_the_screen() {
        let args = windows_producer_args(590698, 1280, 720, 10).join(" ");
        assert!(args.contains("gfxcapture=hwnd=590698"));
        // Never a screen grabber cropped to the window's rectangle.
        assert!(!args.contains("ddagrab"));
        assert!(!args.contains("gdigrab"));
        assert!(!args.contains("crop="));
        assert!(args.contains("pad=1280:720:(ow-iw)/2:(oh-ih)/2"));
        assert!(args.ends_with("-f rawvideo pipe:1"));
    }

    #[test]
    fn macos_producer_gets_the_window_and_canvas() {
        assert_eq!(
            macos_producer_args(77, 1280, 720, 10),
            ["--window", "77", "--width", "1280", "--height", "720", "--fps", "10"]
        );
    }

    #[test]
    fn frame_sizes_match_the_pixel_format() {
        let expected = if cfg!(target_os = "macos") { 1280 * 720 * 4 } else { 1280 * 720 * 3 / 2 };
        assert_eq!(frame_bytes(1280, 720), expected);
    }
}
