// YanLearn Recorder — macOS window-capture helper.
//
// Captures ONE window with ScreenCaptureKit's single-window filter
// (SCContentFilter(desktopIndependentWindow:)), which records that window's own
// content: notifications, other windows or anything else drawn over it are not
// part of the capture. Recording the screen and cropping it to the window would
// include them — exactly what sharing a window instead of the screen avoids.
//
// Writes raw BGRA frames of exactly --width x --height to stdout: the window
// scaled to fit, centred on black. A frame is written whenever ScreenCaptureKit
// delivers one (only when the window changes); the recorder repeats the latest
// frame to keep a steady frame rate (see src-tauri/src/windowfeed.rs). Exits
// when stdin closes (the recorder dropped it), when the window goes away, or on
// a capture error.
//
//   wincapture --window <CGWindowID> --width 1280 --height 720 --fps 10
//
// Built in CI with:
//   swiftc -O -target arm64-apple-macos13.0 -framework ScreenCaptureKit \
//     -framework CoreMedia -framework CoreVideo main.swift -o wincapture-aarch64-apple-darwin

import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
    exit(code)
}

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

/// The command line, parsed into real globals. Values bound by a top-level
/// `guard let` are local to the script body, and the FrameSink class below
/// cannot capture them.
struct Options {
    let windowID: UInt32
    let canvasWidth: Int
    let canvasHeight: Int
    let fps: Int
}

func parseOptions() -> Options {
    guard let windowText = argument("--window"), let windowID = UInt32(windowText),
          let width = Int(argument("--width") ?? ""), width > 1,
          let height = Int(argument("--height") ?? ""), height > 1 else {
        fail("usage: wincapture --window <id> --width <w> --height <h> [--fps <n>]", code: 2)
    }
    let fps = max(1, min(60, Int(argument("--fps") ?? "10") ?? 10))
    return Options(windowID: windowID, canvasWidth: width, canvasHeight: height, fps: fps)
}

let options = parseOptions()
let windowID = options.windowID
let canvasWidth = options.canvasWidth
let canvasHeight = options.canvasHeight
let fps = options.fps

/// The largest even-sized rectangle with the window's shape that fits the canvas.
func fitted(_ size: CGSize) -> (Int, Int) {
    guard size.width > 0, size.height > 0 else { return (canvasWidth, canvasHeight) }
    let scale = min(Double(canvasWidth) / Double(size.width), Double(canvasHeight) / Double(size.height))
    let width = max(2, Int(Double(size.width) * scale) & ~1)
    let height = max(2, Int(Double(size.height) * scale) & ~1)
    return (min(width, canvasWidth), min(height, canvasHeight))
}

@available(macOS 12.3, *)
final class FrameSink: NSObject, SCStreamOutput, SCStreamDelegate {
    private let output = FileHandle.standardOutput
    // Black canvas; each frame is copied into its centre.
    private var canvas: [UInt8]

    override init() {
        canvas = [UInt8](repeating: 0, count: canvasWidth * canvasHeight * 4)
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferIsValid(sampleBuffer) else { return }
        // Only complete frames carry pixels; idle/blank ones mean "no change".
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let rawStatus = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: rawStatus),
              status == .complete,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixels) else { return }
        let width = min(CVPixelBufferGetWidth(pixels), canvasWidth)
        let height = min(CVPixelBufferGetHeight(pixels), canvasHeight)
        let sourceStride = CVPixelBufferGetBytesPerRow(pixels)
        let left = (canvasWidth - width) / 2
        let top = (canvasHeight - height) / 2
        let rowBytes = width * 4

        canvas.withUnsafeMutableBytes { destination in
            guard let target = destination.baseAddress else { return }
            for row in 0..<height {
                let from = base.advanced(by: row * sourceStride)
                let to = target.advanced(by: ((top + row) * canvasWidth + left) * 4)
                memcpy(to, from, rowBytes)
            }
        }
        canvas.withUnsafeBufferPointer { pointer in
            output.write(Data(buffer: pointer))
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        // Usually the window closed. The recorder notices and moves on.
        fail("window capture stopped: \(error.localizedDescription)", code: 1)
    }
}

@available(macOS 12.3, *)
func startCapture() async throws -> SCStream {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
        fail("window \(windowID) was not found", code: 3)
    }
    let (width, height) = fitted(window.frame.size)

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let configuration = SCStreamConfiguration()
    configuration.width = width
    configuration.height = height
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    configuration.showsCursor = true
    configuration.queueDepth = 3
    if #available(macOS 14.0, *) {
        // A window resized mid-segment keeps its proportions (letterboxed)
        // until the recorder starts a fresh segment fitted to its new shape.
        configuration.preservesAspectRatio = true
    }

    let sink = FrameSink()
    let stream = SCStream(filter: filter, configuration: configuration, delegate: sink)
    try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: DispatchQueue(label: "com.yanlearn.recorder.wincapture"))
    try await stream.startCapture()
    // Keep the sink alive for the lifetime of the stream.
    objc_setAssociatedObject(stream, "sink", sink, .OBJC_ASSOCIATION_RETAIN)
    return stream
}

// Exit as soon as the recorder closes our stdin.
DispatchQueue.global(qos: .utility).async {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}

if #available(macOS 12.3, *) {
    // Same shape as the sysaudio helper, which runs in every macOS class.
    Task {
        do {
            _ = try await startCapture()
        } catch {
            fail("capture failed: \(error.localizedDescription)", code: 1)
        }
    }
    dispatchMain()
} else {
    fail("window capture needs macOS 12.3 or newer", code: 2)
}
