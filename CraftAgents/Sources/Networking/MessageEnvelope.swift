// SPDX-License-Identifier: MIT

import Foundation

// MARK: - Wire protocol types

/// Message types on the wire.
public enum MessageType: String, Codable, Sendable {
    case handshake
    case handshakeAck = "handshake_ack"
    case request
    case response
    case event
    case error
    case sequenceAck = "sequence_ack"
}

/// Structured error on the wire.
public struct WireError: Codable, Sendable {
    public let code: String
    public let message: String
    public let data: AnyCodable?

    public init(code: String, message: String, data: AnyCodable? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }
}

/// The on-the-wire envelope for every WebSocket message.
///
/// Matches the server `MessageEnvelope` in `@craft-agent/shared/protocol/types.ts`.
public struct MessageEnvelope: Codable, Sendable {

    // Core fields
    public var id: String
    public var type: MessageType
    public var channel: String?
    public var args: [AnyCodable]?
    public var result: AnyCodable?
    public var error: WireError?

    // Handshake fields
    public var protocolVersion: String?
    public var workspaceId: String?
    public var token: String?
    public var clientId: String?
    public var serverId: String?
    public var clientCapabilities: [String]?
    public var registeredChannels: [String]?

    // Reliable delivery fields
    public var seq: Int?
    public var lastSeq: Int?
    public var reconnectClientId: String?
    public var reconnected: Bool?
    public var stale: Bool?
    public var serverVersion: String?

    public init(
        id: String = UUID().uuidString.lowercased(),
        type: MessageType,
        channel: String? = nil,
        args: [AnyCodable]? = nil,
        result: AnyCodable? = nil,
        error: WireError? = nil,
        protocolVersion: String? = nil,
        workspaceId: String? = nil,
        token: String? = nil,
        clientId: String? = nil,
        serverId: String? = nil,
        clientCapabilities: [String]? = nil,
        registeredChannels: [String]? = nil,
        seq: Int? = nil,
        lastSeq: Int? = nil,
        reconnectClientId: String? = nil,
        reconnected: Bool? = nil,
        stale: Bool? = nil,
        serverVersion: String? = nil
    ) {
        self.id = id
        self.type = type
        self.channel = channel
        self.args = args
        self.result = result
        self.error = error
        self.protocolVersion = protocolVersion
        self.workspaceId = workspaceId
        self.token = token
        self.clientId = clientId
        self.serverId = serverId
        self.clientCapabilities = clientCapabilities
        self.registeredChannels = registeredChannels
        self.seq = seq
        self.lastSeq = lastSeq
        self.reconnectClientId = reconnectClientId
        self.reconnected = reconnected
        self.stale = stale
        self.serverVersion = serverVersion
    }
}

// MARK: - Protocol constants

public enum ProtocolConstants {
    public static let version = "1.0"
    public static let heartbeatIntervalSeconds: TimeInterval = 30
    public static let requestTimeoutSeconds: TimeInterval = 30
    public static let sequenceAckIntervalSeconds: TimeInterval = 5
    public static let disconnectedClientTTLSeconds: TimeInterval = 60
    public static let handshakeTimeoutSeconds: TimeInterval = 5
    public static let timeoutSweepIntervalSeconds: TimeInterval = 1
    static let handshakePollIntervalNanoseconds: UInt64 = 50_000_000 // 50ms
}
