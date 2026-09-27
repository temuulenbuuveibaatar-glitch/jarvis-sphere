@preconcurrency import AVFoundation
@preconcurrency import Speech
import Observation

@MainActor
@Observable
final class SpeechController {
    var transcript = ""
    var isListening = false
    var error = ""

    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: .current)
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func toggle() {
        isListening ? stop() : authorizeAndStart()
    }

    func stop() {
        if engine.isRunning { engine.stop() }
        if request != nil { engine.inputNode.removeTap(onBus: 0) }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        isListening = false
    }

    private func authorizeAndStart() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                guard status == .authorized else { self.error = "Speech recognition permission was denied."; return }
                do { try self.start() }
                catch { self.error = error.localizedDescription; self.stop() }
            }
        }
    }

    private func start() throws {
        stop()
        transcript = ""
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in request.append(buffer) }
        engine.prepare()
        try engine.start()
        isListening = true
        task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result { self.transcript = result.bestTranscription.formattedString }
                if error != nil || result?.isFinal == true { self.stop() }
            }
        }
    }
}
