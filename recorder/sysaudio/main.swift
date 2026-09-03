// YanLearn Recorder — macOS system-audio helper.
//
// Captures the system audio mix with ScreenCaptureKit (macOS 13+) and writes it
// to stdout as raw PCM: signed 16-bit little-endian, 48 kHz, 2 channels
// interleaved. The recorder app pipes this into ffmpeg. Exits when stdin
// closes (the recorder dropped it) or on a capture error.
//
// Built in CI with:
//   swiftc -O -target arm64-apple-macos13.0 -framework ScreenCaptureKit \
//     -framework CoreMedia -framework AVFoundation main.swift -o sysaudio-aarch64-apple-darwin

import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

@inline(__always)
func clampToInt16(_ sample: Float32) -> Int16 {
    let scaled = sample * 32767.0
    if scaled >= 32767.0 { return 32767 }
    if scaled <= -32768.0 { return -32768 }
    return Int16(scaled)
}

@available(macOS 13.0, *)
final class AudioSink: NSObject, SCStreamOutput, SCStreamDelegate {
    private let output = FileHandle.standardOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, CMSampleBufferIsValid(sampleBuffer) else { return }
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else { return }
        let asbd = asbdPointer.pointee
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let nonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        guard isFloat else { return }

        var neededSize = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &neededSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: nil
        )
        guard neededSize > 0 else { return }
        let rawList = UnsafeMutableRawPointer.allocate(byteCount: neededSize, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { rawList.deallocate() }
        let listPointer = rawList.bindMemory(to: AudioBufferList.self, capacity: 1)
        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: listPointer,
            bufferListSize: neededSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr else { return }

        let buffers = UnsafeMutableAudioBufferListPointer(listPointer)
        let frames = Int(CMSampleBufferGetNumSamples(sampleBuffer))
        guard frames > 0, buffers.count > 0 else { return }
        var pcm = [Int16](repeating: 0, count: frames * 2)

        if nonInterleaved {
            let channelCount = buffers.count
            for channel in 0..<2 {
                let source = buffers[min(channel, channelCount - 1)]
                guard let data = source.mData else { continue }
                let samples = data.assumingMemoryBound(to: Float32.self)
                let available = Int(source.mDataByteSize) / MemoryLayout<Float32>.size
                for frame in 0..<min(frames, available) {
                    pcm[frame * 2 + channel] = clampToInt16(samples[frame])
                }
            }
        } else {
            let source = buffers[0]
            guard let data = source.mData else { return }
            let samples = data.assumingMemoryBound(to: Float32.self)
            let channels = max(Int(asbd.mChannelsPerFrame), 1)
            let available = Int(source.mDataByteSize) / MemoryLayout<Float32>.size
            for frame in 0..<frames {
                for channel in 0..<2 {
                    let index = frame * channels + min(channel, channels - 1)
                    if index < available {
                        pcm[frame * 2 + channel] = clampToInt16(samples[index])
                    }
                }
            }
        }

        pcm.withUnsafeBufferPointer { pointer in
            output.write(Data(buffer: pointer))
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write("stream stopped: \(error.localizedDescription)\n".data(using: .utf8)!)
        exit(1)
    }
}

@available(macOS 13.0, *)
func startCapture() async throws -> SCStream {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let display = content.displays.first else {
        throw NSError(domain: "sysaudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display found"])
    }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.capturesAudio = true
    configuration.excludesCurrentProcessAudio = true
    configuration.sampleRate = 48000
    configuration.channelCount = 2
    // Video is mandatory for an SCStream; make it as cheap as possible.
    configuration.width = 2
    configuration.height = 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    configuration.showsCursor = false

    let sink = AudioSink()
    let stream = SCStream(filter: filter, configuration: configuration, delegate: sink)
    try stream.addStreamOutput(sink, type: .audio, sampleHandlerQueue: DispatchQueue(label: "com.yanlearn.recorder.sysaudio"))
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

if #available(macOS 13.0, *) {
    Task {
        do {
            _ = try await startCapture()
        } catch {
            FileHandle.standardError.write("capture failed: \(error.localizedDescription)\n".data(using: .utf8)!)
            exit(1)
        }
    }
    dispatchMain()
} else {
    FileHandle.standardError.write("system audio capture needs macOS 13 or newer\n".data(using: .utf8)!)
    exit(2)
}
