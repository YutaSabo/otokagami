require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'AzurePronunciationStream'
  s.version = package['version']
  s.summary = 'Low-latency Azure pronunciation assessment streaming for Expo iOS.'
  s.description = s.summary
  s.license = 'MIT'
  s.author = 'Pronunciation Mirror'
  s.homepage = 'https://pronunciationmirror.app'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.source_files = '**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.dependency 'MicrosoftCognitiveServicesSpeech-iOS', '~> 1.43.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
