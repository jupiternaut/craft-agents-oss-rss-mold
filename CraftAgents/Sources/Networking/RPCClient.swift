// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - RPC errors

public enum RPCError: Error, LocalizedError, Sendable {
    case notConnected
    case requestTimeout(channel: String)
    case serverError(code: String, message: String)
    case decodingFailed(String)
    case channelNotAvailable(String)
    case transportError(Error)

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "RPC client is not connected."
        case .requestTimeout(let channel):
            return "Request timed out for channel: \(channel)"
        case .serverError(let code, let message):
            return "Server error [\(code)]: \(message)"
        case .decodingFailed(let detail):
            return "Failed to decode response: \(detail)"
        case .channelNotAvailable(let channel):
            return "Channel not available on server: \(channel)"
        case .transportError(let underlying):
            return "Transport error: \(underlying.localizedDescription)"
        }
    }
}

// MARK: - Pending request

private struct PendingRequest: Sendable {
    let id: String
    let channel: String
    let continuation: CheckedContinuation<AnyCodable?, Error>
    let deadline: Date
}

// MARK: - RPCClient

/// High-level RPC client layered on ``WebSocketTransport``.
///
/// Provides typed `request(channel:args:)` calls with UUID-based correlation,
/// timeout handling, and Combine-based event streaming.
public actor RPCClient {

    // MARK: - Dependencies

    private let transport: WebSocketTransport

    // MARK: - State

    private var pendingRequests: [String: PendingRequest] = [:]
    private var subscriptionTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Published

    /// Server events parsed from `session:event` channel pushes.
    public nonisolated let events = PassthroughSubject<ServerEvent, Never>()

    /// Raw envelopes for event-type messages (for custom handling).
    public nonisolated let rawEvents = PassthroughSubject<MessageEnvelope, Never>()

    /// Connection state (forwarded from transport).
    public nonisolated var connectionState: AnyPublisher<ConnectionState, Never> {
        transport.connectionStateSubject.eraseToAnyPublisher()
    }

    // MARK: - Init

    public init(transport: WebSocketTransport? = nil) {
        self.transport = transport ?? WebSocketTransport()
    }

    // MARK: - Connection

    /// Connect to a Craft Agents server.
    ///
    /// - Parameters:
    ///   - url: The WebSocket server URL.
    ///   - token: Optional bearer token for remote auth.
    ///   - workspaceId: Workspace ID to join.
    public func connect(url: URL, token: String?, workspaceId: String) async throws {
        startListening()
        startTimeoutSweep()

        do {
            try await transport.connect(url: url, token: token, workspaceId: workspaceId)
        } catch {
            throw RPCError.transportError(error)
        }
    }

    /// Disconnect from the server. All pending requests are cancelled.
    public func disconnect() async {
        subscriptionTask?.cancel()
        subscriptionTask = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        cancellables.removeAll()

        // Cancel all pending requests
        let pending = pendingRequests
        pendingRequests.removeAll()
        for req in pending.values {
            req.continuation.resume(throwing: RPCError.notConnected)
        }

        await transport.disconnect()
    }

    // MARK: - RPC request

    /// Send an RPC request and wait for the correlated response.
    ///
    /// - Parameters:
    ///   - channel: The RPC channel (e.g. `"sessions:sendMessage"`).
    ///   - args: Positional arguments encoded as `AnyCodable`.
    /// - Returns: The decoded result of type `T`.
    /// - Throws: ``RPCError`` on timeout, server error, or decoding failure.
    public func request<T: Decodable>(channel: String, args: [AnyCodable] = []) async throws -> T {
        let raw = try await requestRaw(channel: channel, args: args)
        return try decodeResult(raw, as: T.self)
    }

    /// Send an RPC request and return the raw `AnyCodable?` result.
    public func requestRaw(channel: String, args: [AnyCodable] = []) async throws -> AnyCodable? {
        guard await transport.isConnected else {
            throw RPCError.notConnected
        }

        let id = UUID().uuidString.lowercased()

        let envelope = MessageEnvelope(
            id: id,
            type: .request,
            channel: channel,
            args: args
        )

        return try await withCheckedThrowingContinuation { continuation in
            let pending = PendingRequest(
                id: id,
                channel: channel,
                continuation: continuation,
                deadline: Date().addingTimeInterval(ProtocolConstants.requestTimeoutSeconds)
            )

            // Must store before sending to avoid race
            pendingRequests[id] = pending

            Task {
                do {
                    try await transport.send(envelope)
                } catch {
                    // Remove pending and fail if send itself errors
                    if let removed = await removePending(id: id) {
                        removed.continuation.resume(throwing: RPCError.transportError(error))
                    }
                }
            }
        }
    }

    /// Fire-and-forget variant — sends an RPC request without waiting for a response.
    public func notify(channel: String, args: [AnyCodable] = []) async throws {
        guard await transport.isConnected else {
            throw RPCError.notConnected
        }

        let envelope = MessageEnvelope(
            type: .request,
            channel: channel,
            args: args
        )

        try await transport.send(envelope)
    }

    // MARK: - Envelope subscription

    private func startListening() {
        subscriptionTask?.cancel()
        subscriptionTask = Task { [weak self] in
            guard let self else { return }

            let stream = AsyncStream<MessageEnvelope> { continuation in
                let cancellable = self.transport.incomingEnvelopes.sink { envelope in
                    continuation.yield(envelope)
                }
                continuation.onTermination = { _ in
                    cancellable.cancel()
                }
            }

            for await envelope in stream {
                guard !Task.isCancelled else { return }
                await self.handleEnvelope(envelope)
            }
        }
    }

    private func handleEnvelope(_ envelope: MessageEnvelope) {
        switch envelope.type {
        case .response:
            handleResponse(envelope)

        case .error where pendingRequests[envelope.id] != nil:
            handleResponse(envelope)

        case .event:
            handleEvent(envelope)

        case .handshake, .handshakeAck, .sequenceAck:
            break // Handled by transport

        case .error:
            // Broadcast error not correlated to a request
            handleEvent(envelope)

        case .request:
            break // Server-initiated requests (e.g. invokeClient) — not handled yet
        }
    }

    private func handleResponse(_ envelope: MessageEnvelope) {
        guard let pending = pendingRequests.removeValue(forKey: envelope.id) else {
            return
        }

        if let wireError = envelope.error {
            pending.continuation.resume(
                throwing: RPCError.serverError(code: wireError.code, message: wireError.message)
            )
        } else {
            pending.continuation.resume(returning: envelope.result)
        }
    }

    private func handleEvent(_ envelope: MessageEnvelope) {
        rawEvents.send(envelope)

        // Parse session:event channel events
        if envelope.channel == "session:event",
           let args = envelope.args,
           let firstArg = args.first,
           let dict = firstArg.dictionaryValue,
           let event = ServerEvent.from(eventPayload: dict) {
            events.send(event)
        }

        // Parse other broadcast channels
        if envelope.channel == "sources:changed",
           let args = envelope.args,
           let wid = args.first?.stringValue {
            events.send(.globalSourcesChanged(workspaceId: wid))
        }

        if envelope.channel == "skills:changed",
           let args = envelope.args,
           let wid = args.first?.stringValue {
            events.send(.globalSkillsChanged(workspaceId: wid))
        }
    }

    // MARK: - Timeout sweep

    private func startTimeoutSweep() {
        timeoutTask?.cancel()
        timeoutTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(ProtocolConstants.timeoutSweepIntervalSeconds * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await self?.sweepTimedOut()
            }
        }
    }

    private func sweepTimedOut() {
        let now = Date()
        let timedOut = pendingRequests.filter { $0.value.deadline < now }

        for (id, pending) in timedOut {
            pendingRequests.removeValue(forKey: id)
            pending.continuation.resume(throwing: RPCError.requestTimeout(channel: pending.channel))
        }
    }

    // MARK: - Helpers

    private func removePending(id: String) -> PendingRequest? {
        pendingRequests.removeValue(forKey: id)
    }

    private func decodeResult<T: Decodable>(_ raw: AnyCodable?, as type: T.Type) throws -> T {
        // Handle Void-like result (when T is AnyCodable? or optional)
        if T.self == AnyCodable.self || T.self == AnyCodable?.self {
            guard let result = (raw ?? AnyCodable.null) as? T else {
                throw RPCError.decodingFailed("Cannot cast AnyCodable to \(T.self)")
            }
            return result
        }

        guard let raw else {
            // If T is optional, return nil
            if let nilValue = Optional<Any>.none as? T {
                return nilValue
            }
            throw RPCError.decodingFailed("Response result is null but expected \(T.self)")
        }

        // Re-encode the AnyCodable to JSON, then decode to T
        let data = try JSONEncoder().encode(raw)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw RPCError.decodingFailed("Failed to decode \(T.self): \(error.localizedDescription)")
        }
    }

    // MARK: - Accessors

    /// The underlying transport layer.
    public var transportLayer: WebSocketTransport { transport }
}

// MARK: - Convenience RPC methods

extension RPCClient {

    /// Fetch sessions list from the server.
    public func getSessions(workspaceId: String) async throws -> AnyCodable {
        try await request(channel: "sessions:get", args: [AnyCodable(workspaceId)])
    }

    /// Create a new session.
    public func createSession(workspaceId: String, options: [String: AnyCodable] = [:]) async throws -> AnyCodable {
        try await request(channel: "sessions:create", args: [AnyCodable(workspaceId), AnyCodable(options)])
    }

    /// Send a message to a session.
    public func sendMessage(
        sessionId: String,
        content: String,
        options: [String: AnyCodable] = [:]
    ) async throws -> AnyCodable {
        try await request(
            channel: "sessions:sendMessage",
            args: [AnyCodable(sessionId), AnyCodable(content), AnyCodable(options)]
        )
    }

    /// Cancel an active session.
    public func cancelSession(sessionId: String) async throws -> AnyCodable {
        try await request(channel: "sessions:cancel", args: [AnyCodable(sessionId)])
    }

    /// Respond to a permission request.
    public func respondToPermission(
        sessionId: String,
        requestId: String,
        allowed: Bool,
        options: [String: AnyCodable] = [:]
    ) async throws -> AnyCodable {
        try await request(
            channel: "sessions:respondToPermission",
            args: [AnyCodable(sessionId), AnyCodable(requestId), AnyCodable(allowed), AnyCodable(options)]
        )
    }

    /// Respond to a credential request.
    public func respondToCredential(
        sessionId: String,
        response: [String: AnyCodable]
    ) async throws -> AnyCodable {
        try await request(
            channel: "sessions:respondToCredential",
            args: [AnyCodable(sessionId), AnyCodable(response)]
        )
    }

    /// Delete a session.
    public func deleteSession(workspaceId: String, sessionId: String) async throws -> AnyCodable {
        try await request(channel: "sessions:delete", args: [AnyCodable(workspaceId), AnyCodable(sessionId)])
    }

    /// Get messages for a session.
    public func getMessages(sessionId: String) async throws -> AnyCodable {
        try await request(channel: "sessions:getMessages", args: [AnyCodable(sessionId)])
    }

    /// Execute a session command (flag, unflag, rename, etc.).
    public func sessionCommand(sessionId: String, command: [String: AnyCodable]) async throws -> AnyCodable {
        try await request(channel: "sessions:command", args: [AnyCodable(sessionId), AnyCodable(command)])
    }

    /// Get server health / status.
    public func getServerStatus() async throws -> AnyCodable {
        try await request(channel: "server:getStatus", args: [])
    }
}
