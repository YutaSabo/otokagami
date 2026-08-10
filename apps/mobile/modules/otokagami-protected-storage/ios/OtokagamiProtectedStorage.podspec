Pod::Spec.new do |s|
  s.name           = 'OtokagamiProtectedStorage'
  s.version        = '0.1.0'
  s.summary        = 'Protected local storage boundary for Otokagami v2.'
  s.description    = 'Creates backup-excluded, file-protected Application Support storage.'
  s.author         = 'Otokagami'
  s.homepage       = 'https://example.invalid'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
