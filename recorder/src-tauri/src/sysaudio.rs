//! System audio (what the tutor hears — the students in the Discord call).
//!
//! ffmpeg cannot capture system audio by itself on either platform, so the
//! recorder feeds it raw PCM over a loopback TCP socket:
//!
//!  * Windows — WASAPI loopback on the output device the tutor chose. WASAPI
//!    stops delivering packets while nothing is playing, so the feeder pads
//!    silence against the wall clock to keep the stream real-time and in sync.
//!  * macOS — the bundled `sysaudio` helper (ScreenCaptureKit) writes the system
//!    mix to its stdout; ScreenCaptureKit captures every app's audio regardless
//!    of the output device, so no device choice applies there.
//!
//! ffmpeg reads the socket as `-f s16le -ar 48000 -ac 2 -i tcp://127.0.0.1:PORT`
//! and mixes it with the microphone (see capture.rs).

use std::io::{ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::capture::AudioDevice;

const SAMPLE_RATE: u64 = 48_000;
const CHANNELS: u64 = 2;
const BYTES_PER_FRAME: u64 = 2 * CHANNELS;

pub struct SystemAudioFeeder {
    port: u16,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl SystemAudioFeeder {
    pub fn start(output_device_id: Option<String>) -> Result<Self, String> {
        if !(cfg!(windows) || cfg!(target_os = "macos")) {
            return Err("System audio capture is not supported on this platform.".into());
        }
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        let thread = std::thread::spawn(move || {
            let Some(stream) = accept_with_timeout(&listener, &stop_flag, Duration::from_secs(20)) else {
                return;
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_nodelay(true);
            // A stopped/unresponsive ffmpeg must not leave the feeder stuck in
            // write_all, preventing its stop flag from being checked.
            let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
            if let Err(err) = feed(output_device_id, stream, stop_flag) {
                eprintln!("system audio feeder stopped: {err}");
            }
        });
        Ok(Self {
            port,
            stop,
            thread: Some(thread),
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for SystemAudioFeeder {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Accept the ffmpeg connection, giving up on `stop` or after `timeout`. Also
/// used by the window feeder (windowfeed.rs).
pub(crate) fn accept_with_timeout(
    listener: &TcpListener,
    stop: &AtomicBool,
    timeout: Duration,
) -> Option<TcpStream> {
    let deadline = Instant::now() + timeout;
    loop {
        if stop.load(Ordering::SeqCst) || Instant::now() > deadline {
            return None;
        }
        match listener.accept() {
            Ok((stream, _)) => return Some(stream),
            Err(err) if err.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }
}

/// Keeps `written` bytes in step with the wall clock by writing zeros when the
/// source is behind (e.g. WASAPI delivering nothing during silence).
struct RealtimePacer {
    started: Instant,
    written: u64,
}

impl RealtimePacer {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            written: 0,
        }
    }

    fn account(&mut self, bytes: usize) {
        self.written += bytes as u64;
    }

    fn pad_silence(&mut self, stream: &mut TcpStream) -> std::io::Result<()> {
        let expected = (self.started.elapsed().as_secs_f64() * (SAMPLE_RATE * BYTES_PER_FRAME) as f64) as u64;
        // Only pad once we are more than 50 ms behind; real packets close smaller gaps.
        let threshold = SAMPLE_RATE * BYTES_PER_FRAME / 20;
        if expected > self.written + threshold {
            let missing = (((expected - self.written) / BYTES_PER_FRAME) * BYTES_PER_FRAME)
                .min(SAMPLE_RATE * BYTES_PER_FRAME / 4);
            let zeros = vec![0u8; missing as usize];
            stream.write_all(&zeros)?;
            self.written += missing;
        }
        Ok(())
    }
}

#[cfg(windows)]
fn feed(
    output_device_id: Option<String>,
    mut stream: TcpStream,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    use std::collections::VecDeque;
    use wasapi::{Direction, SampleType, ShareMode, WaveFormat};

    let _ = wasapi::initialize_mta();
    let device = match output_device_id.filter(|id| !id.is_empty()) {
        Some(id) => find_render_device(&id)?,
        None => wasapi::get_default_device(&Direction::Render).map_err(|e| e.to_string())?,
    };
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let format = WaveFormat::new(16, 16, &SampleType::Int, SAMPLE_RATE as usize, CHANNELS as usize, None);
    let block_align = format.get_blockalign() as usize;
    let (_default_period, min_period) = client.get_periods().map_err(|e| e.to_string())?;
    // A render device opened for capture is a loopback capture.
    client
        .initialize_client(&format, min_period, &Direction::Capture, &ShareMode::Shared, true)
        .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture_client = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;

    let mut queue: VecDeque<u8> = VecDeque::new();
    let mut pacer = RealtimePacer::new();
    let result = loop {
        if stop.load(Ordering::SeqCst) {
            break Ok(());
        }
        if let Err(err) = capture_client.read_from_device_to_deque(block_align, &mut queue) {
            break Err(err.to_string());
        }
        if !queue.is_empty() {
            let bytes: Vec<u8> = queue.drain(..).collect();
            if let Err(err) = stream.write_all(&bytes) {
                break Err(err.to_string());
            }
            pacer.account(bytes.len());
        }
        if let Err(err) = pacer.pad_silence(&mut stream) {
            break Err(err.to_string());
        }
        // Times out (returns Err) when nothing is playing; that is not an error here.
        let _ = event.wait_for_event(100);
    };
    let _ = client.stop_stream();
    result
}

#[cfg(windows)]
fn find_render_device(id: &str) -> Result<wasapi::Device, String> {
    use wasapi::{DeviceCollection, Direction};
    let collection = DeviceCollection::new(&Direction::Render).map_err(|e| e.to_string())?;
    let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;
    for index in 0..count {
        let device = collection.get_device_at_index(index).map_err(|e| e.to_string())?;
        if device.get_id().map_err(|e| e.to_string())? == id {
            return Ok(device);
        }
    }
    Err(format!("The chosen output device ({id}) is no longer available."))
}

/// Output devices the tutor can choose for system audio (Windows).
#[cfg(windows)]
pub fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
    // COM is initialized per thread; enumerate on a fresh one so the UI
    // thread's apartment type never matters.
    std::thread::spawn(|| -> Result<Vec<AudioDevice>, String> {
        use wasapi::{DeviceCollection, Direction};
        let _ = wasapi::initialize_mta();
        let collection = DeviceCollection::new(&Direction::Render).map_err(|e| e.to_string())?;
        let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;
        let mut devices = Vec::new();
        for index in 0..count {
            let device = collection.get_device_at_index(index).map_err(|e| e.to_string())?;
            let id = device.get_id().map_err(|e| e.to_string())?;
            let name = device.get_friendlyname().unwrap_or_else(|_| id.clone());
            devices.push(AudioDevice { id, name });
        }
        Ok(devices)
    })
    .join()
    .map_err(|_| "device enumeration thread panicked".to_string())?
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(vec![])
}

#[cfg(target_os = "macos")]
fn feed(
    _output_device_id: Option<String>,
    stream: TcpStream,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    use std::process::Stdio;

    let helper = crate::capture::sidecar_path("sysaudio")?;
    let child = crate::capture::command(&helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start the system audio helper: {e}"))?;
    feed_helper(child, stream, stop)
}

#[cfg(any(target_os = "macos", test))]
fn feed_helper(
    mut child: std::process::Child,
    mut stream: TcpStream,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    use std::io::Read;
    use std::sync::mpsc::{sync_channel, RecvTimeoutError};

    let mut stdout = child
        .stdout
        .take()
        .ok_or("system audio helper has no stdout")?;
    // ScreenCaptureKit may produce no audio at all once a call ends. A blocking
    // stdout.read on this worker would never see stop=true. Keep that read on
    // its own thread, with a bounded queue and a cancellable receive here.
    let (sender, receiver) = sync_channel(8);
    let reader = std::thread::spawn(move || {
        let mut buffer = vec![0u8; 16 * 1024];
        loop {
            let packet = match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => Ok(buffer[..count].to_vec()),
                Err(err) if err.kind() == ErrorKind::Interrupted => continue,
                Err(err) => Err(err.to_string()),
            };
            let failed = packet.is_err();
            if sender.send(packet).is_err() || failed { break; }
        }
    });
    let mut pacer = RealtimePacer::new();
    let result = loop {
        if stop.load(Ordering::SeqCst) {
            break Ok(());
        }
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(Ok(bytes)) => {
                if let Err(err) = stream.write_all(&bytes) {
                    break Err(err.to_string());
                }
                pacer.account(bytes.len());
            }
            Ok(Err(err)) => break Err(err),
            Err(RecvTimeoutError::Disconnected) => break Err("the system audio helper exited".into()),
            Err(RecvTimeoutError::Timeout) => {}
        }
        if let Err(err) = pacer.pad_silence(&mut stream) {
            break Err(err.to_string());
        }
    };
    // Release a reader blocked on the bounded queue before closing the child.
    drop(receiver);
    // Closing stdin tells the helper to exit; kill it if it does not.
    drop(child.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader.join();
    result
}

#[cfg(not(any(windows, target_os = "macos")))]
fn feed(
    _output_device_id: Option<String>,
    _stream: TcpStream,
    _stop: Arc<AtomicBool>,
) -> Result<(), String> {
    Err("System audio capture is not supported on this platform.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::process::Stdio;

    // Run in a child process: emulate ScreenCaptureKit keeping stdout open
    // but producing no audio after the call ends.
    #[test]
    #[ignore = "subprocess fixture"]
    fn silent_helper() {
        let mut input = Vec::new();
        std::io::stdin().read_to_end(&mut input).unwrap();
    }

    #[test]
    fn silent_audio_helper_can_be_stopped_without_waiting_for_more_audio() {
        let child = crate::capture::command(&std::env::current_exe().unwrap())
            .args(["--exact", "sysaudio::tests::silent_helper", "--ignored", "--nocapture"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        stream.set_write_timeout(Some(Duration::from_secs(1))).unwrap();
        let (mut audio, _) = listener.accept().unwrap();
        let drain = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            audio.read_to_end(&mut bytes).unwrap();
            bytes.len()
        });
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let (done, result) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            done.send(feed_helper(child, stream, worker_stop)).unwrap();
        });
        std::thread::sleep(Duration::from_millis(200));
        stop.store(true, Ordering::SeqCst);
        assert!(result.recv_timeout(Duration::from_secs(4)).expect("audio shutdown hung").is_ok());
        worker.join().unwrap();
        assert!(drain.join().unwrap() > 0, "silent input should still provide audio frames");
    }
}
