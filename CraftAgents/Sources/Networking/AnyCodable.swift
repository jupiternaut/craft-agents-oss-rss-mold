// SPDX-License-Identifier: MIT

import Foundation

/// A type-erased `Codable` wrapper for heterogeneous JSON values.
///
/// Supports `null`, `Bool`, `Int`, `Double`, `String`, `[AnyCodable]`,
/// and `[String: AnyCodable]`. Round-trips through `JSONEncoder`/`JSONDecoder`.
public struct AnyCodable: Codable, Hashable, Sendable, CustomStringConvertible {

    public let value: any Sendable

    public init(_ value: any Sendable) {
        self.value = value
    }

    // MARK: - Convenience accessors

    public var stringValue: String? { value as? String }
    public var intValue: Int? { value as? Int }
    public var doubleValue: Double? { value as? Double }
    public var boolValue: Bool? { value as? Bool }
    public var arrayValue: [AnyCodable]? { value as? [AnyCodable] }
    public var dictionaryValue: [String: AnyCodable]? { value as? [String: AnyCodable] }
    public var isNil: Bool { value is NSNull }

    // MARK: - Codable

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [AnyCodable]:
            try container.encode(array)
        case let dict as [String: AnyCodable]:
            try container.encode(dict)
        default:
            throw EncodingError.invalidValue(
                value,
                EncodingError.Context(codingPath: encoder.codingPath,
                                      debugDescription: "Unsupported type: \(type(of: value))")
            )
        }
    }

    // MARK: - Hashable

    public func hash(into hasher: inout Hasher) {
        switch value {
        case is NSNull:       hasher.combine(0)
        case let b as Bool:   hasher.combine(b)
        case let i as Int:    hasher.combine(i)
        case let d as Double: hasher.combine(d)
        case let s as String: hasher.combine(s)
        case let a as [AnyCodable]:          hasher.combine(a)
        case let d as [String: AnyCodable]:  hasher.combine(d)
        default: hasher.combine(String(describing: type(of: value)))
        }
    }

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case (is NSNull, is NSNull):                             return true
        case let (l as Bool, r as Bool):                         return l == r
        case let (l as Int, r as Int):                           return l == r
        case let (l as Double, r as Double):                     return l == r
        case let (l as String, r as String):                     return l == r
        case let (l as [AnyCodable], r as [AnyCodable]):         return l == r
        case let (l as [String: AnyCodable], r as [String: AnyCodable]): return l == r
        default: return false
        }
    }

    // MARK: - CustomStringConvertible

    public var description: String {
        switch value {
        case is NSNull: return "null"
        case let v as Bool: return String(describing: v)
        case let v as Int: return String(describing: v)
        case let v as Double: return String(describing: v)
        case let v as String: return "\"\(v)\""
        case let v as [AnyCodable]: return String(describing: v)
        case let v as [String: AnyCodable]: return String(describing: v)
        default: return String(describing: value)
        }
    }

    // MARK: - Factory helpers

    public static let null = AnyCodable(NSNull())

    public static func from(_ any: Any?) -> AnyCodable {
        guard let any else { return .null }
        switch any {
        case let v as Bool:   return AnyCodable(v)
        case let v as Int:    return AnyCodable(v)
        case let v as Double: return AnyCodable(v)
        case let v as String: return AnyCodable(v)
        case let v as [Any?]:
            return AnyCodable(v.map { AnyCodable.from($0) })
        case let v as [String: Any?]:
            return AnyCodable(v.mapValues { AnyCodable.from($0) })
        default:
            return AnyCodable(String(describing: any))
        }
    }
}

// MARK: - ExpressibleBy literals

extension AnyCodable: ExpressibleByNilLiteral {
    public init(nilLiteral: ()) { self.init(NSNull()) }
}

extension AnyCodable: ExpressibleByBooleanLiteral {
    public init(booleanLiteral value: Bool) { self.init(value) }
}

extension AnyCodable: ExpressibleByIntegerLiteral {
    public init(integerLiteral value: Int) { self.init(value) }
}

extension AnyCodable: ExpressibleByFloatLiteral {
    public init(floatLiteral value: Double) { self.init(value) }
}

extension AnyCodable: ExpressibleByStringLiteral {
    public init(stringLiteral value: String) { self.init(value) }
}

extension AnyCodable: ExpressibleByArrayLiteral {
    public init(arrayLiteral elements: AnyCodable...) { self.init(elements) }
}

extension AnyCodable: ExpressibleByDictionaryLiteral {
    public init(dictionaryLiteral elements: (String, AnyCodable)...) {
        self.init(Dictionary(uniqueKeysWithValues: elements))
    }
}
