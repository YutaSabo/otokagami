import ExpoModulesCore
import Foundation

public final class OtokagamiProtectedStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtokagamiProtectedStorage")

    AsyncFunction("prepare") { () -> [String: String] in
      let directories = try self.prepareDirectories()
      return ["databaseDirectoryUri": directories.database.absoluteString]
    }

    AsyncFunction("protectDatabase") { (databaseName: String) in
      guard self.isSafeKey(databaseName, suffix: ".sqlite") else {
        throw ProtectedStorageException("INVALID_DATABASE_NAME")
      }
      let directories = try self.prepareDirectories()
      for suffix in ["", "-wal", "-shm"] {
        let url = directories.database.appendingPathComponent(databaseName + suffix)
        if FileManager.default.fileExists(atPath: url.path) {
          try self.protect(url)
        }
      }
    }

    AsyncFunction("storeAudio") { (sourceUri: String, fileKey: String) in
      guard let source = URL(string: sourceUri), source.isFileURL,
            self.isSafeKey(fileKey, suffix: ".wav") else {
        throw ProtectedStorageException("INVALID_AUDIO_REFERENCE")
      }
      let destination = try self.audioUrl(fileKey)
      try? FileManager.default.removeItem(at: destination)
      try FileManager.default.moveItem(at: source, to: destination)
      try self.protect(destination)
    }

    AsyncFunction("deleteAudio") { (fileKey: String) in
      let url = try self.audioUrl(fileKey)
      if FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.removeItem(at: url)
      }
    }

    AsyncFunction("audioExists") { (fileKey: String) -> Bool in
      let url = try self.audioUrl(fileKey)
      return FileManager.default.fileExists(atPath: url.path)
    }

    AsyncFunction("resolveAudio") { (fileKey: String) -> String? in
      let url = try self.audioUrl(fileKey)
      return FileManager.default.fileExists(atPath: url.path) ? url.absoluteString : nil
    }
  }

  private func prepareDirectories() throws -> (root: URL, database: URL, audio: URL) {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let root = base.appendingPathComponent("Otokagami/v2", isDirectory: true)
    let database = root.appendingPathComponent("database", isDirectory: true)
    let audio = root.appendingPathComponent("audio", isDirectory: true)
    for directory in [root, database, audio] {
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
      try self.protect(directory)
    }
    return (root, database, audio)
  }

  private func audioUrl(_ fileKey: String) throws -> URL {
    guard isSafeKey(fileKey, suffix: ".wav") else {
      throw ProtectedStorageException("INVALID_AUDIO_KEY")
    }
    return try prepareDirectories().audio.appendingPathComponent(fileKey)
  }

  private func protect(_ url: URL) throws {
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: url.path
    )
    var resource = URLResourceValues()
    resource.isExcludedFromBackup = true
    var mutableUrl = url
    try mutableUrl.setResourceValues(resource)
  }

  private func isSafeKey(_ value: String, suffix: String) -> Bool {
    guard value.hasSuffix(suffix), value.count <= 160 else { return false }
    let base = String(value.dropLast(suffix.count))
    return !base.isEmpty && base.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
  }
}

private final class ProtectedStorageException: GenericException<String> {
  override var reason: String { param }
}
