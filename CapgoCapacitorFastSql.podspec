require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'CapgoCapacitorFastSql'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['repository']['url']
  s.author = package['author']
  s.source = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.1'
  s.default_subspecs = 'Core'

  s.subspec 'Core' do |ss|
    ss.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
    ss.dependency 'Capacitor'
    ss.dependency 'Telegraph', '~> 0.30'
  end

  # Optional encryption support. Include this subspec to enable SQLCipher.
  s.subspec 'SQLCipher' do |ss|
    ss.dependency 'CapgoCapacitorFastSql/Core'
    ss.dependency 'SQLCipher', '~> 4.10'
  end
end
