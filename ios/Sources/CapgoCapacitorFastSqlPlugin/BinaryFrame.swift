import Foundation
import CoreFoundation

enum BinaryFrameError: Error {
    case invalid
    case limit
}

/// Version 1 envelope shared with Android and JavaScript. Data stays binary.
enum BinaryFrame {
    static let contentType = "application/vnd.capgo.fast-sql.v1+binary"
    static let maxBytes = 64 * 1024 * 1024
    private static let maxMetadata = 1024 * 1024
    private static let headerBytes = 12
    private static let magic: [UInt8] = [70, 83, 81, 49]

    static func encode(_ value: Any) throws -> Data {
        var attachments = Data()
        var nodes = 0
        var blobs = 0
        func encodeValue(_ value: Any, depth: Int) throws -> Any {
            nodes += 1
            guard nodes <= 100000, depth <= 32 else { throw BinaryFrameError.limit }
            if let bytes = value as? Data {
                blobs += 1
                guard blobs <= 4096, attachments.count + bytes.count <= maxBytes - headerBytes else { throw BinaryFrameError.limit }
                let reference = ["$blob": [attachments.count, bytes.count]]
                attachments.append(bytes)
                return reference
            }
            if let number = value as? NSNumber, !number.doubleValue.isFinite { throw BinaryFrameError.invalid }
            if let array = value as? [Any] { return try array.map { try encodeValue($0, depth: depth + 1) } }
            if let object = value as? [String: Any] {
                return try object.mapValues { try encodeValue($0, depth: depth + 1) }
            }
            return value
        }
        let metadata = try JSONSerialization.data(withJSONObject: encodeValue(value, depth: 0), options: [.fragmentsAllowed])
        guard metadata.count <= maxMetadata, headerBytes + metadata.count + attachments.count <= maxBytes else { throw BinaryFrameError.limit }
        var output = Data(magic)
        for count in [metadata.count, attachments.count] {
            var littleEndian = UInt32(count).littleEndian
            withUnsafeBytes(of: &littleEndian) { output.append(contentsOf: $0) }
        }
        output.append(metadata)
        output.append(attachments)
        return output
    }

    static func decode(_ frame: Data) throws -> Any {
        guard frame.count >= headerBytes, frame.count <= maxBytes, Array(frame.prefix(4)) == magic else { throw BinaryFrameError.invalid }
        let metadataLength = frame.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self))) }
        let payloadLength = frame.withUnsafeBytes { Int(UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: 8, as: UInt32.self))) }
        let payloadOffset = headerBytes + metadataLength
        guard metadataLength > 0, metadataLength <= maxMetadata, payloadOffset + payloadLength == frame.count else { throw BinaryFrameError.invalid }
        let start = frame.startIndex
        let metadata = frame.subdata(in: (start + headerBytes)..<(start + payloadOffset))
        guard String(data: metadata, encoding: .utf8) != nil else { throw BinaryFrameError.invalid }
        var nesting = 0
        var quoted = false
        var escaped = false
        for byte in metadata {
            if quoted {
                if escaped { escaped = false } else if byte == 92 { escaped = true } else if byte == 34 { quoted = false }
            } else if byte == 34 { quoted = true } else if byte == 91 || byte == 123 {
                nesting += 1
                guard nesting <= 33 else { throw BinaryFrameError.limit }
            } else if byte == 93 || byte == 125 { nesting -= 1 }
        }
        guard let value = try? JSONSerialization.jsonObject(with: metadata, options: [.fragmentsAllowed]) else { throw BinaryFrameError.invalid }
        var nodes = 0
        var blobs = 0
        var referencedBytes = 0
        func decodeValue(_ value: Any, depth: Int) throws -> Any {
            nodes += 1
            guard nodes <= 100000, depth <= 32 else { throw BinaryFrameError.limit }
            if let array = value as? [Any] { return try array.map { try decodeValue($0, depth: depth + 1) } }
            guard let object = value as? [String: Any] else { return value }
            if object.count == 1, let raw = object["$blob"] {
                guard let reference = raw as? [NSNumber], reference.count == 2 else { throw BinaryFrameError.invalid }
                let offset = reference[0].doubleValue
                let count = reference[1].doubleValue
                guard reference.allSatisfy({ CFGetTypeID($0) != CFBooleanGetTypeID() }), offset.isFinite, count.isFinite,
                      offset >= 0, count >= 0, offset.rounded() == offset, count.rounded() == count,
                      offset + count <= Double(payloadLength) else { throw BinaryFrameError.invalid }
                referencedBytes += Int(count)
                blobs += 1
                guard blobs <= 4096, referencedBytes <= maxBytes else { throw BinaryFrameError.limit }
                return frame.subdata(in: (start + payloadOffset + Int(offset))..<(start + payloadOffset + Int(offset) + Int(count)))
            }
            return try object.mapValues { try decodeValue($0, depth: depth + 1) }
        }
        return try decodeValue(value, depth: 0)
    }
}
