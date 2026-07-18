import AVFoundation
import ExpoModulesCore
import MicrosoftCognitiveServicesSpeech

public final class AzurePronunciationStreamModule: Module {
  private let controller = PronunciationStreamController()

  public func definition() -> ModuleDefinition {
    Name("AzurePronunciationStream")

    AsyncFunction("prepare") { (options: [String: String]) in
      try self.controller.prepare(options: options)
    }

    AsyncFunction("start") { (requestId: String) in
      try self.controller.start(requestId: requestId)
    }

    AsyncFunction("finish") { (requestId: String, promise: Promise) in
      self.controller.finish(requestId: requestId, promise: promise)
    }

    AsyncFunction("cancel") { (requestId: String) in
      self.controller.cancel(requestId: requestId)
    }

    AsyncFunction("updateToken") { (token: String, requestId: String) in
      try self.controller.updateToken(token: token, requestId: requestId)
    }
  }
}

private final class PronunciationStreamController {
  private let minimumAudioBytes = 8_000 // 250ms at 16kHz, 16-bit, mono.
  private let maximumAudioBytes = 960_000 // 30 seconds.
  private let lock = NSLock()
  private var requestId: String?
  private var audioEngine: AVAudioEngine?
  private var converter: AVAudioConverter?
  private var pushStream: SPXPushAudioInputStream?
  private var recognizer: SPXSpeechRecognizer?
  private var pcmData = Data()
  private var audioTooLong = false
  private var recognitionResult: SPXSpeechRecognitionResult?
  private var finishPromise: Promise?
  private var recordingStartedAt: TimeInterval?
  private var streamClosedAt: TimeInterval?
  private var conversionFailureCount = 0

  func prepare(options: [String: String]) throws -> [String: Double] {
    guard let token = options["token"], !token.isEmpty,
          let region = options["region"], !region.isEmpty,
          let locale = options["locale"], !locale.isEmpty,
          let referenceText = options["referenceText"], !referenceText.isEmpty,
          let requestId = options["requestId"], !requestId.isEmpty else {
      throw StreamException("INVALID_PREPARATION", "発音判定の準備情報が不足しています。")
    }

    cancelCurrentSession()
    let speechConfig = try SPXSpeechConfiguration(authorizationToken: token, region: region)
    speechConfig.speechRecognitionLanguage = locale
    speechConfig.outputFormat = SPXOutputFormat.detailed

    guard let streamFormat = SPXAudioStreamFormat(usingPCMWithSampleRate: 16_000, bitsPerSample: 16, channels: 1),
          let pushStream = SPXPushAudioInputStream(audioFormat: streamFormat),
          let audioConfig = SPXAudioConfiguration(streamInput: pushStream) else {
      throw StreamException("RECOGNIZER_PREPARATION_FAILED", "発音判定を準備できませんでした。")
    }
    let recognizer = try SPXSpeechRecognizer(speechConfiguration: speechConfig, audioConfiguration: audioConfig)

    let assessment = try SPXPronunciationAssessmentConfiguration(
      referenceText,
      gradingSystem: .hundredMark,
      granularity: .phoneme,
      enableMiscue: true
    )
    assessment.phonemeAlphabet = "IPA"
    assessment.nbestPhonemeCount = 5
    assessment.enableProsodyAssessment()
    try assessment.apply(to: recognizer)

    let engine = AVAudioEngine()
    let inputFormat = engine.inputNode.outputFormat(forBus: 0)
    guard inputFormat.channelCount > 0 else {
      throw StreamException("AUDIO_FORMAT_UNAVAILABLE", "マイクの音声形式を準備できませんでした。")
    }

    lock.lock()
    self.requestId = requestId
    self.audioEngine = engine
    // AVAudioSession activation can change the actual input format and route.
    // The converter is therefore created in start(), after the session is active.
    self.converter = nil
    self.pushStream = pushStream
    self.recognizer = recognizer
    self.pcmData = Data()
    self.audioTooLong = false
    self.recognitionResult = nil
    self.finishPromise = nil
    self.recordingStartedAt = nil
    self.streamClosedAt = nil
    self.conversionFailureCount = 0
    lock.unlock()

    return ["preparedAtMs": Date().timeIntervalSince1970 * 1_000]
  }

  func start(requestId: String) throws -> [String: Double] {
    try assertCurrent(requestId)
    guard let engine = audioEngine, let recognizer = recognizer else {
      throw StreamException("NOT_PREPARED", "発音判定の準備が完了していません。")
    }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
    try session.setPreferredSampleRate(16_000)
    try session.setActive(true)

    let input = engine.inputNode
    input.removeTap(onBus: 0)
    let inputFormat = input.outputFormat(forBus: 0)
    guard inputFormat.channelCount > 0,
          let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true),
          let activeConverter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
      throw StreamException("AUDIO_FORMAT_UNAVAILABLE", "マイクの音声形式を準備できませんでした。")
    }
    lock.lock()
    converter = activeConverter
    lock.unlock()
    input.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { [weak self] buffer, _ in
      self?.consume(buffer)
    }
    engine.prepare()
    try engine.start()

    let startedAt = Date().timeIntervalSince1970
    lock.lock()
    recordingStartedAt = startedAt
    lock.unlock()

    try recognizer.recognizeOnceAsync { [weak self] result in
      self?.receive(result: result, requestId: requestId)
    }
    return ["recordingStartedAtMs": startedAt * 1_000]
  }

  func finish(requestId: String, promise: Promise) {
    do {
      try assertCurrent(requestId)
      guard let engine = audioEngine else { throw StreamException("NOT_RECORDING", "録音が開始されていません。") }
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      lock.lock()
      streamClosedAt = Date().timeIntervalSince1970
      finishPromise = promise
      lock.unlock()
      pushStream?.close()
      resolveIfReady()
      DispatchQueue.global().asyncAfter(deadline: .now() + 15) { [weak self] in
        self?.rejectTimedOutFinish(requestId: requestId)
      }
    } catch {
      promise.reject(error)
    }
  }

  func cancel(requestId: String) {
    guard self.requestId == requestId else { return }
    cancelCurrentSession()
  }

  func updateToken(token: String, requestId: String) throws {
    try assertCurrent(requestId)
    recognizer?.authorizationToken = token
  }

  private func consume(_ buffer: AVAudioPCMBuffer) {
    guard let converter = converter,
          let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true) else { return }
    let ratio = 16_000 / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(max(1, ceil(Double(buffer.frameLength) * ratio)))
    guard let converted = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
    var supplied = false
    var conversionError: NSError?
    let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
      if supplied {
        outStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      outStatus.pointee = .haveData
      return buffer
    }
    guard status != .error, converted.frameLength > 0,
          let channel = converted.int16ChannelData?.pointee else {
      lock.lock()
      conversionFailureCount += 1
      lock.unlock()
      return
    }
    let data = Data(bytes: channel, count: Int(converted.frameLength) * MemoryLayout<Int16>.size)
    lock.lock()
    if pcmData.count + data.count > maximumAudioBytes {
      audioTooLong = true
      lock.unlock()
      return
    }
    pcmData.append(data)
    let stream = pushStream
    lock.unlock()
    stream?.write(data)
  }

  private func receive(result: SPXSpeechRecognitionResult, requestId: String) {
    lock.lock()
    guard self.requestId == requestId else {
      lock.unlock()
      return
    }
    recognitionResult = result
    lock.unlock()
    resolveIfReady()
  }

  private func resolveIfReady() {
    lock.lock()
    guard let promise = finishPromise, let result = recognitionResult, let requestId = requestId else {
      lock.unlock()
      return
    }
    finishPromise = nil
    let audio = pcmData
    let wasTooLong = audioTooLong
    let startedAt = recordingStartedAt
    let closedAt = streamClosedAt
    let conversionFailures = conversionFailureCount
    lock.unlock()

    do {
      let activity = audioActivity(audio)
      let route = AVAudioSession.sharedInstance().currentRoute.inputs.map { $0.portType.rawValue }.joined(separator: ",")
      let activeInputFormat = audioEngine?.inputNode.outputFormat(forBus: 0)
      NSLog("pronunciation_audio_diagnostics bytes=\(audio.count) duration_ms=\(Double(audio.count) / 32.0) rms=\(activity.rms) peak=\(activity.peak) max_frame_rms=\(activity.maximumFrameRms) noise_floor=\(activity.noiseFloorRms) active_ratio=\(activity.activeFrameRatio) conversion_failures=\(conversionFailures) input_rate=\(activeInputFormat?.sampleRate ?? 0) input_channels=\(activeInputFormat?.channelCount ?? 0) route=\(route)")
      if conversionFailures > 0 && (audio.count < minimumAudioBytes || !activity.hasSpeech) {
        throw StreamException("AUDIO_FORMAT_UNAVAILABLE", "マイク音声を変換できませんでした。Bluetoothを切り替えて、もう一度お試しください。")
      }
      guard audio.count >= minimumAudioBytes else { throw StreamException("AUDIO_TOO_SHORT", "音声が短すぎます。0.25秒以上話してください。") }
      guard !wasTooLong else { throw StreamException("AUDIO_TOO_LONG", "音声が長すぎます。30秒以内で録音してください。") }
      guard activity.hasSpeech else { throw StreamException("SILENCE", "音声を検出できませんでした。マイクへ近づいてもう一度お試しください。") }
      let json = result.properties?.getPropertyBy(SPXPropertyId.speechServiceResponseJsonResult) ?? ""
      guard let jsonData = json.data(using: .utf8),
            let raw = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
        throw StreamException("INVALID_AZURE_RESULT", "Azureの判定結果を読み取れませんでした。")
      }
      if let status = raw["RecognitionStatus"] as? String, status != "Success" {
        throw StreamException("AZURE_RECOGNITION_FAILED", "Azureの音声認識を完了できませんでした。もう一度お試しください。")
      }
      let fileUrl = try writeWave(data: audio, requestId: requestId)
      let latency = result.properties?.getPropertyBy(SPXPropertyId.speechServiceResponseRecognitionLatencyMs)
      promise.resolve([
        "requestId": requestId,
        "rawJson": raw,
        "localAudioUri": fileUrl.absoluteString,
        "audioDurationMs": Double(audio.count) / 32.0,
        "recognitionLatencyMs": latency.flatMap(Double.init) as Any,
        "buttonToResultMs": closedAt.map { Date().timeIntervalSince1970 * 1_000 - $0 * 1_000 } as Any,
        "recordingDurationMs": startedAt.map { Date().timeIntervalSince1970 * 1_000 - $0 * 1_000 } as Any,
        "audioRms": activity.rms,
        "audioPeak": activity.peak,
        "activeFrameRatio": activity.activeFrameRatio
      ])
      clearAfterCompletion()
    } catch {
      promise.reject(error)
      clearAfterCompletion()
    }
  }

  private func writeWave(data: Data, requestId: String) throws -> URL {
    let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("pronunciation-recordings", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let safeId = requestId.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
    let url = directory.appendingPathComponent("\(safeId).wav")
    var wave = Data()
    wave.append("RIFF".data(using: .ascii)!)
    wave.appendUInt32LE(UInt32(36 + data.count))
    wave.append("WAVEfmt ".data(using: .ascii)!)
    wave.appendUInt32LE(16)
    wave.appendUInt16LE(1)
    wave.appendUInt16LE(1)
    wave.appendUInt32LE(16_000)
    wave.appendUInt32LE(32_000)
    wave.appendUInt16LE(2)
    wave.appendUInt16LE(16)
    wave.append("data".data(using: .ascii)!)
    wave.appendUInt32LE(UInt32(data.count))
    wave.append(data)
    try wave.write(to: url, options: .atomic)
    return url
  }

  private func assertCurrent(_ requestId: String) throws {
    guard self.requestId == requestId else { throw StreamException("STALE_REQUEST", "古い発音判定リクエストです。") }
  }

  private func rejectTimedOutFinish(requestId: String) {
    lock.lock()
    guard self.requestId == requestId, recognitionResult == nil, let promise = finishPromise else {
      lock.unlock()
      return
    }
    finishPromise = nil
    lock.unlock()
    promise.reject(StreamException("AZURE_RESULT_TIMEOUT", "Azureから判定結果が返りませんでした。もう一度お試しください。"))
    clearAfterCompletion()
  }

  private func audioActivity(_ audio: Data) -> AudioActivity {
    let samples = audio.int16Samples()
    guard !samples.isEmpty else { return .silent }
    let frameSize = 320 // 20ms at 16kHz.
    let frameRms = stride(from: 0, to: samples.count, by: frameSize).map { start -> Double in
      let end = min(samples.count, start + frameSize)
      let meanSquare = samples[start..<end].reduce(0.0) { $0 + Double($1) * Double($1) } / Double(end - start)
      return sqrt(meanSquare)
    }
    let sortedRms = frameRms.sorted()
    let noiseFloor = sortedRms[min(sortedRms.count - 1, sortedRms.count / 5)]
    let activeThreshold = max(180.0, noiseFloor * 2.5)
    let activeFrames = frameRms.filter { $0 >= activeThreshold }.count
    let activeRatio = Double(activeFrames) / Double(frameRms.count)
    let meanSquare = samples.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(samples.count)
    let peak = samples.reduce(0) { max($0, abs(Int($1))) }
    let maximumFrameRms = frameRms.max() ?? 0
    let hasSpeech = peak >= 600 && maximumFrameRms >= 250 && activeFrames >= 2 && activeRatio >= 0.02
    return AudioActivity(
      rms: sqrt(meanSquare),
      peak: peak,
      maximumFrameRms: maximumFrameRms,
      noiseFloorRms: noiseFloor,
      activeFrameRatio: activeRatio,
      hasSpeech: hasSpeech
    )
  }

  private func cancelCurrentSession() {
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    pushStream?.close()
    finishPromise?.reject(StreamException("CANCELLED", "発音判定をキャンセルしました。"))
    clearAfterCompletion()
  }

  private func clearAfterCompletion() {
    lock.lock()
    requestId = nil
    audioEngine = nil
    converter = nil
    pushStream = nil
    recognizer = nil
    pcmData = Data()
    audioTooLong = false
    recognitionResult = nil
    finishPromise = nil
    recordingStartedAt = nil
    streamClosedAt = nil
    conversionFailureCount = 0
    lock.unlock()
  }
}

private final class StreamException: Exception, @unchecked Sendable {
  private let streamCode: String
  private let message: String

  init(_ code: String, _ reason: String) {
    self.streamCode = code
    self.message = reason
    super.init()
  }

  override var code: String {
    streamCode
  }

  override var reason: String {
    message
  }
}

private struct AudioActivity {
  let rms: Double
  let peak: Int
  let maximumFrameRms: Double
  let noiseFloorRms: Double
  let activeFrameRatio: Double
  let hasSpeech: Bool

  static let silent = AudioActivity(
    rms: 0,
    peak: 0,
    maximumFrameRms: 0,
    noiseFloorRms: 0,
    activeFrameRatio: 0,
    hasSpeech: false
  )
}

private extension Data {
  func int16Samples() -> [Int16] {
    guard count >= 2 else { return [] }
    return stride(from: 0, to: count - 1, by: 2).map { index in
      Int16(bitPattern: UInt16(self[index]) | (UInt16(self[index + 1]) << 8))
    }
  }

  mutating func appendUInt16LE(_ value: UInt16) {
    var little = value.littleEndian
    append(Data(bytes: &little, count: MemoryLayout<UInt16>.size))
  }

  mutating func appendUInt32LE(_ value: UInt32) {
    var little = value.littleEndian
    append(Data(bytes: &little, count: MemoryLayout<UInt32>.size))
  }
}
