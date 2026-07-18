import CoreAudio
import Foundation

func deviceID(named name: String) -> AudioDeviceID? {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return nil }
  let count = Int(size) / MemoryLayout<AudioDeviceID>.size
  fputs("audio device count: \(count)\\n", stderr)
  var devices = Array(repeating: AudioDeviceID(), count: count)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices) == noErr else { return nil }
  for device in devices {
    var nameAddress = AudioObjectPropertyAddress(
      mSelector: kAudioObjectPropertyName,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var cfName: CFString = "" as CFString
    var nameSize = UInt32(MemoryLayout<CFString>.size)
    let nameStatus = AudioObjectGetPropertyData(device, &nameAddress, 0, nil, &nameSize, &cfName)
    guard nameStatus == noErr else { continue }
    if (cfName as String) == name { return device }
  }
  return nil
}

let arguments = Array(CommandLine.arguments.suffix(2))
guard arguments.count == 2,
      let device = deviceID(named: arguments[1]) else {
  fputs("usage: codex-audio-device.swift input|output device-name\\n", stderr)
  exit(2)
}

let selector: AudioObjectPropertySelector = arguments[0] == "input"
  ? kAudioHardwarePropertyDefaultInputDevice
  : kAudioHardwarePropertyDefaultOutputDevice
var address = AudioObjectPropertyAddress(
  mSelector: selector,
  mScope: kAudioObjectPropertyScopeGlobal,
  mElement: kAudioObjectPropertyElementMain
)
var target = device
let status = AudioObjectSetPropertyData(
  AudioObjectID(kAudioObjectSystemObject),
  &address,
  0,
  nil,
  UInt32(MemoryLayout<AudioDeviceID>.size),
  &target
)
guard status == noErr else {
  fputs("unable to select audio device (status \\(status))\\n", stderr)
  exit(1)
}
print("ok")
