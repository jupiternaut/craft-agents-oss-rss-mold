// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - Connection state

/// The current state of the WebSocket transport layer.
public enum ConnectionState: String, Sendable {
    case disconnected
    case connecting
    case connected
    case error
}

// MARK: - Transport errors

public enum TransportError: Error, LocalizedError, Sendable {
    case notConnected
    case handshakeTimeout
    case handshakeFailed(String)
    case protocolVersionMismatch(server: String, client: String)
    case authFailed(String)
    case invalidMessage
    case connectionClosed(code: Int, reason: String)
    case encodingFailed
    case maxReconnectAttemptsExceeded

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "WebSocket is not connected."
        case .handshakeTimeout:
            return "Handshake timed out."
        case .handshakeFailed(let reason):
            return "Handshake failed: \(reason)"
        case .protocolVersionMismatch(let server, let client):
            return "Protocol version mismatch — server: \(server), client: \(client)"
        case .authFailed(let reason):
            return "Authentication failed: \(reason)"
        case .invalidMessage:
            return "Received an invalid message."
        case .connectionClosed(let code, let reason):
            return "Connection closed (\(code)): \(reason)"
        case .encodingFailed:
            return "Failed to encode message."
        case .maxReconnectAttemptsExceeded:
            return "Maximum reconnection attempts exceeded."
        }
    }
}

// MARK: - WebSocketTransport

/// Transport layer for the Craft Agents JSON-RPC protocol over WebSocket.
///
/// Manages connection lifecycle, handshake, heartbeat, sequence tracking,
/// and automatic reconnection with exponential backoff.
///
/// Thread-safe via actor isolation. Publishes connection state and incoming
/// envelopes via Combine subjects.
public actor WebSocketTransport {

    // MARK: - Published state

    /// Current connection state (observe from any isolation via `nonisolated`).
    public nonisolated let connectionStateSubject = CurrentValueSubject<ConnectionState, Never>(.disconnected)

    /// Incoming envelopes after handshake (events, responses, errors).
    public nonisolated let incomingEnvelopes = PassthroughSubject<MessageEnvelope, Never>()

    // MARK: - Configuration

    private var serverURL: URL?
    private var token: String?
    private var workspaceId: String?

    // MARK: - Connection state

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var clientId: String?
    private var registeredChannels: Set<String> = []
    private var serverVersion: String?
    private var lastReceivedSeq: Int = 0
    private var isHandshakeComplete = false

    // MARK: - Reconnection

    private var reconnectAttempt = 0
    private var maxReconnectAttempts = 10
    private var reconnectTask: Task<Void, Never>?
    private var shouldReconnect = false

    // MARK: - Timers

    private var sequenceAckTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?

    // MARK: - JSON coding

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = []
        return e
    }()

    private let decoder = JSONDecoder()

    // MARK: - Init / deinit

    public init() {}

    // MARK: - Connect

    /// Connect to a Craft Agents WebSocket server.
    ///
    /// - Parameters:
    ///   - url: Server WebSocket URL (`ws://` or `wss://`).
    ///   - token: Optional bearer token for remote-mode auth.
    ///   - workspaceId: Workspace to join.
    public func connect(url: URL, token: String?, workspaceId: String) async throws {
        self.serverURL = url
        self.token = token
        self.workspaceId = workspaceId
        self.shouldReconnect = true
        self.reconnectAttempt = 0

        try await openConnection(isReconnect: false)
    }

    /// Disconnect and stop any reconnection attempts.
    public func disconnect() {
        shouldReconnect = false
        cancelTasks()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        isHandshakeComplete = false
        connectionStateSubject.send(.disconnected)
    }

    // MARK: - Send

    /// Send a fully formed envelope to the server.
    public func send(_ envelope: MessageEnvelope) async throws {
        guard let ws = webSocketTask, isHandshakeComplete else {
            throw TransportError.notConnected
        }

        guard let data = try? encoder.encode(envelope),
              let text = String(data: data, encoding: .utf8) else {
            throw TransportError.encodingFailed
        }

        try await ws.send(.string(text))
    }

    // MARK: - Internal connection logic

    private func openConnection(isReconnect: Bool) async throws {
        guard let url = serverURL else {
            throw TransportError.notConnected
        }

        cancelTasks()

        connectionStateSubject.send(.connecting)

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        let session = URLSession(configuration: config)
        urlSession = session

        var request = URLRequest(url: url)
        request.timeoutInterval = ProtocolConstants.handshakeTimeoutSeconds

        let ws = session.webSocketTask(with: request)
        webSocketTask = ws
        ws.resume()

        // Start receiving immediately (before handshake) so we can get the ack.
        startReceiving()

        // Perform handshake
        try await performHandshake(isReconnect: isReconnect)
    }

    private func performHandshake(isReconnect: Bool) async throws {
        var handshake = MessageEnvelope(
            type: .handshake,
            protocolVersion: ProtocolConstants.version,
            workspaceId: workspaceId
        )

        if let token {
            handshake.token = token
        }

        // Reconnection: include previous clientId and last acked seq
        if isReconnect, let prevClientId = clientId {
            handshake.reconnectClientId = prevClientId
            handshake.lastSeq = lastReceivedSeq
        }

        guard let data = try? encoder.encode(handshake),
              let text = String(data: data, encoding: .utf8) else {
            throw TransportError.encodingFailed
        }

        try await webSocketTask?.send(.string(text))

        // Wait for handshake_ack (with timeout)
        let ack = try await waitForHandshakeAck()

        // Process ack
        clientId = ack.clientId
        registeredChannels = Set(ack.registeredChannels ?? [])
        serverVersion = ack.serverVersion

        if ack.stale == true {
            // Server buffer was evicted; client should do a full state refresh.
            lastReceivedSeq = 0
        }

        isHandshakeComplete = true
        reconnectAttempt = 0
        connectionStateSubject.send(.connected)

        // Start periodic sequence ack
        startSequenceAckTimer()
    }

    /// Waits for a `handshake_ack` envelope, timing out after 5 seconds.
    private func waitForHandshakeAck() async throws -> MessageEnvelope {
        try await withCheckedThrowingContinuation { continuation in
            let timeoutTask = Task {
                let deadline = Date().addingTimeInterval(ProtocolConstants.handshakeTimeoutSeconds)
                while Date() < deadline {
                    try Task.checkCancellation()
                    try await Task.sleep(nanoseconds: ProtocolConstants.handshakePollIntervalNanoseconds)
                }
                continuation.resume(throwing: TransportError.handshakeTimeout)
            }

            var cancellable: AnyCancellable?
            cancellable = incomingEnvelopes
                .first(where: { $0.type == .handshakeAck || $0.type == .error })
                .sink { envelope in
                    timeoutTask.cancel()
                    cancellable?.cancel()
                    cancellable = nil

                    if envelope.type == .error {
                        let msg = envelope.error?.message ?? "Unknown handshake error"
                        let code = envelope.error?.code ?? "UNKNOWN"
                        if code == "AUTH_FAILED" {
                            continuation.resume(throwing: TransportError.authFailed(msg))
                        } else if code == "PROTOCOL_VERSION_UNSUPPORTED" {
                            continuation.resume(throwing: TransportError.protocolVersionMismatch(
                                server: msg, client: ProtocolConstants.version))
                        } else {
                            continuation.resume(throwing: TransportError.handshakeFailed(msg))
                        }
                    } else {
                        continuation.resume(returning: envelope)
                    }
                }
        }
    }

    // MARK: - Receive loop

    private func startReceiving() {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
    }

    private func receiveLoop() async {
        guard let ws = webSocketTask else { return }

        while !Task.isCancelled {
            do {
                let message = try await ws.receive()
                await handleReceivedMessage(message)
            } catch {
                if !Task.isCancelled {
                    await handleDisconnection(error: error)
                }
                return
            }
        }
    }

    private func handleReceivedMessage(_ message: URLSessionWebSocketTask.Message) async {
        let text: String
        switch message {
        case .string(let s):
            text = s
        case .data(let d):
            guard let s = String(data: d, encoding: .utf8) else { return }
            text = s
        @unknown default:
            return
        }

        guard let data = text.data(using: .utf8),
              let envelope = try? decoder.decode(MessageEnvelope.self, from: data) else {
            return
        }

        // Track sequence numbers from server events
        if let seq = envelope.seq, seq > lastReceivedSeq {
            lastReceivedSeq = seq
        }

        // Forward to the subject (the receive loop runs before handshake completes
        // so the handshake-ack listener can pick it up)
        incomingEnvelopes.send(envelope)
    }

    // MARK: - Sequence acknowledgment

    private func startSequenceAckTimer() {
        sequenceAckTask?.cancel()
        sequenceAckTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(ProtocolConstants.sequenceAckIntervalSeconds * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await self?.sendSequenceAck()
            }
        }
    }

    private func sendSequenceAck() async {
        guard isHandshakeComplete, lastReceivedSeq > 0 else { return }

        let ack = MessageEnvelope(
            type: .sequenceAck,
            lastSeq: lastReceivedSeq
        )

        try? await send(ack)
    }

    // MARK: - Heartbeat (WebSocket ping/pong)

    /// Send a WebSocket-level ping. `URLSessionWebSocketTask` handles pong
    /// automatically. We call this periodically if needed, though the server
    /// also pings.
    public func sendPing() async {
        webSocketTask?.sendPing { _ in }
    }

    // MARK: - Reconnection

    private func handleDisconnection(error: Error?) async {
        isHandshakeComplete = false

        guard shouldReconnect else {
            connectionStateSubject.send(.disconnected)
            return
        }

        connectionStateSubject.send(.error)

        guard reconnectAttempt < maxReconnectAttempts else {
            connectionStateSubject.send(.disconnected)
            return
        }

        await scheduleReconnect()
    }

    private func scheduleReconnect() async {
        reconnectAttempt += 1

        // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
        let baseDelay: TimeInterval = 1.0
        let delay = min(baseDelay * pow(2.0, Double(reconnectAttempt - 1)), 30.0)

        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            do {
                try await self?.openConnection(isReconnect: true)
            } catch {
                await self?.handleDisconnection(error: error)
            }
        }
    }

    // MARK: - Cleanup

    private func cancelTasks() {
        receiveTask?.cancel()
        receiveTask = nil
        sequenceAckTask?.cancel()
        sequenceAckTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
    }

    // MARK: - Accessors

    /// The client ID assigned by the server after handshake.
    public var assignedClientId: String? { clientId }

    /// Channels registered on the server.
    public var serverRegisteredChannels: Set<String> { registeredChannels }

    /// The server version string from the last handshake ack.
    public var serverVersionString: String? { serverVersion }

    /// Whether the transport is currently connected and handshake is complete.
    public var isConnected: Bool { isHandshakeComplete }
}
