//! Wait for local video preparation while reporting progress and stopping stalls.
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Clone, Default, PartialEq)]
struct Counters {
    media_us: u64,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub elapsed_seconds: u64,
    pub idle_seconds: u64,
    pub processed_seconds: u64,
    pub size_bytes: u64,
}

/// `child` must have piped stdout/stderr and use ffmpeg's `-progress pipe:1`.
/// A repeated heartbeat alone is not progress: media time, bytes, or the output
/// file must change. File writes cover faststart's final metadata relocation.
pub fn wait(
    child: &mut Child,
    output: &Path,
    idle_timeout: Duration,
    mut report: impl FnMut(Progress),
) -> Result<(), String> {
    let counters = Arc::new(Mutex::new(Counters::default()));
    let progress_counters = counters.clone();
    let stdout = child.stdout.take().ok_or("Preparation has no progress pipe")?;
    let progress_reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Some((key, value)) = line.split_once('=') else { continue };
            let Ok(value) = value.parse::<u64>() else { continue };
            if let Ok(mut counters) = progress_counters.lock() {
                match key {
                    "out_time_us" => counters.media_us = counters.media_us.max(value),
                    "total_size" => counters.bytes = counters.bytes.max(value),
                    _ => {}
                }
            }
        }
    });
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_tail = tail.clone();
    let stderr = child.stderr.take().ok_or("Preparation has no error pipe")?;
    let error_reader = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut tail) = stderr_tail.lock() {
                tail.push_back(line.chars().take(1000).collect::<String>());
                while tail.len() > 12 { tail.pop_front(); }
            }
        }
    });
    let started = Instant::now();
    let mut last_progress = started;
    let mut next_report = started;
    let mut previous_counters = Counters::default();
    let mut previous_file = None;
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(error) => break Err(format!("Could not check recording preparation: {error}")),
            Ok(None) => {}
        }
        let current = counters.lock().map(|value| value.clone()).unwrap_or_default();
        let file = std::fs::metadata(output).ok().map(|meta| (meta.len(), meta.modified().ok()));
        let now = Instant::now();
        if current != previous_counters || file != previous_file {
            last_progress = now;
            previous_counters = current.clone();
            previous_file = file;
        }
        if now >= next_report {
            report(Progress {
                elapsed_seconds: started.elapsed().as_secs(),
                idle_seconds: last_progress.elapsed().as_secs(),
                processed_seconds: current.media_us / 1_000_000,
                size_bytes: current.bytes.max(file.map(|value| value.0).unwrap_or(0)),
            });
            next_report = now + Duration::from_secs(1);
        }
        if last_progress.elapsed() >= idle_timeout {
            break Err(format!(
                "Recording preparation stalled with no progress for {} seconds. Original recording segments have been kept.",
                idle_timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    // End the old process before JS can retry against the same output file.
    if result.is_err() { let _ = child.kill(); }
    let _ = child.wait();
    let _ = progress_reader.join();
    let _ = error_reader.join();
    let status = result?;
    if !status.success() {
        let message = tail.lock().map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        return Err(format!("Could not combine the recording segments ({status}): {message}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::Stdio;

    #[test]
    #[ignore = "subprocess fixture"]
    fn preparation_helper() {
        let mode = std::env::var("YANLEARN_PREPARATION_TEST").unwrap();
        if mode == "failure" {
            eprintln!("invalid segment in recording");
            std::process::exit(1);
        }
        for index in 1..=16 {
            // Noisy/repeated reports must not keep a stalled worker alive.
            let time = if mode == "progress" { index * 1_000_000 } else { 0 };
            println!("out_time_us={time}\nprogress=continue");
            std::io::stdout().flush().unwrap();
            if mode == "file-progress" {
                std::fs::write(std::env::var("YANLEARN_PREPARATION_OUTPUT").unwrap(), vec![0; index]).unwrap();
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn helper(mode: &str, output: &Path) -> Child {
        crate::capture::command(&std::env::current_exe().unwrap())
            .args(["--exact", "preparation::tests::preparation_helper", "--ignored", "--nocapture"])
            .env("YANLEARN_PREPARATION_TEST", mode).env("YANLEARN_PREPARATION_OUTPUT", output)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().unwrap()
    }

    #[test]
    fn kills_a_stalled_process_even_if_it_keeps_reporting_the_same_progress() {
        let output = std::env::temp_dir().join(format!("recorder-stalled-{}.mp4", std::process::id()));
        let mut child = helper("stalled", &output);
        let error = wait(&mut child, &output, Duration::from_millis(350), |_| {}).unwrap_err();
        assert!(error.contains("stalled"));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn lets_slow_preparation_finish_while_media_progress_advances() {
        let output = std::env::temp_dir().join(format!("recorder-progress-{}.mp4", std::process::id()));
        let mut child = helper("progress", &output);
        wait(&mut child, &output, Duration::from_millis(350), |_| {}).unwrap();
    }

    #[test]
    fn accepts_file_writes_during_final_metadata_relocation() {
        let output = std::env::temp_dir().join(format!("recorder-faststart-{}.mp4", std::process::id()));
        let mut child = helper("file-progress", &output);
        wait(&mut child, &output, Duration::from_millis(350), |_| {}).unwrap();
        assert_eq!(std::fs::metadata(&output).unwrap().len(), 16);
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn reports_the_media_error_when_preparation_exits_unsuccessfully() {
        let output = std::env::temp_dir().join(format!("recorder-failed-{}.mp4", std::process::id()));
        let mut child = helper("failure", &output);
        let error = wait(&mut child, &output, Duration::from_secs(5), |_| {}).unwrap_err();
        assert!(error.contains("invalid segment"));
    }
}
