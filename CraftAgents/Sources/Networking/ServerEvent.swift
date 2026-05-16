// SPDX-License-Identifier: MIT

import Foundation

// MARK: - Supporting model types

/// Lightweight session metadata returned on session_created events.
public struct SessionMeta: Codable, Sendable, Identifiable {
    public let id: String
    public var workspaceId: String?
    public var workspaceName: String?
    public var name: String?
    public var lastMessageAt: Double?
    public var isProcessing: Bool?
    public var permissionMode: String?
}

// Note: `Message` and `TokenUsage` are defined in Models/ and shared
// across the app. They are decoded from event payloads via
// `decodeFromAnyCodable`.

/// Permission request payload from the server.
public struct PermissionRequestData: Codable, Sendable {
    public let requestId: String
    public var sessionId: String?
    public var toolName: String?
    public var command: String?
    public var description: String?
    public var type: String?
    public var appName: String?
    public var reason: String?
    public var impact: String?
}

/// Credential request payload from the server.
public struct CredentialRequestData: Codable, Sendable {
    public let requestId: String
    public var sessionId: String?
    public var serviceName: String?
    public var serviceUrl: String?
    public var inputMode: String?
    public var message: String?
}

// MARK: - Server event enum

/// Events pushed by the server on the `session:event` channel.
///
/// The server sends a `SessionEvent` object as the first item in the
/// `args` array of an event-type envelope. The `type` discriminator
/// selects the case.
public enum ServerEvent: Sendable {
    case textDelta(sessionId: String, delta: String, turnId: String?)
    case textComplete(sessionId: String, text: String, turnId: String?, messageId: String?)
    case userMessage(sessionId: String, message: Message, status: String)
    case toolStart(sessionId: String, toolName: String, toolUseId: String,
                   toolInput: [String: AnyCodable]?, turnId: String?)
    case toolResult(sessionId: String, toolUseId: String, toolName: String?,
                    result: String, isError: Bool, turnId: String?)
    case toolProgress(sessionId: String, toolUseId: String, elapsedSeconds: Double, turnId: String?)
    case permissionRequest(sessionId: String, request: PermissionRequestData)
    case credentialRequest(sessionId: String, request: CredentialRequestData)
    case complete(sessionId: String, tokenUsage: TokenUsage?)
    case interrupted(sessionId: String)
    case error(sessionId: String, message: String)
    case status(sessionId: String, message: String, statusType: String?)
    case info(sessionId: String, message: String, level: String?)
    case nameChanged(sessionId: String, name: String?)
    case titleGenerated(sessionId: String, title: String)
    case sessionFlagged(sessionId: String)
    case sessionUnflagged(sessionId: String)
    case sessionArchived(sessionId: String)
    case sessionUnarchived(sessionId: String)
    case permissionModeChanged(sessionId: String, mode: String, previousMode: String?)
    case sessionCreated(sessionId: String)
    case sessionDeleted(sessionId: String)
    case sessionStatusChanged(sessionId: String, sessionStatus: String)
    case sessionModelChanged(sessionId: String, model: String?)
    case workingDirectoryChanged(sessionId: String, workingDirectory: String)
    case planSubmitted(sessionId: String, message: Message)
    case taskBackgrounded(sessionId: String, toolUseId: String, taskId: String, intent: String?)
    case taskProgress(sessionId: String, toolUseId: String, elapsedSeconds: Double)
    case taskCompleted(sessionId: String, taskId: String, status: String)
    case sourcesChanged(sessionId: String, enabledSourceSlugs: [String])
    case labelsChanged(sessionId: String, labels: [String])
    case connectionChanged(sessionId: String, connectionSlug: String)
    case usageUpdate(sessionId: String, inputTokens: Int?, contextWindow: Int?)
    case asyncOperation(sessionId: String, isOngoing: Bool)

    // Broadcast events (not session-scoped, from other channels)
    case globalSourcesChanged(workspaceId: String)
    case globalSkillsChanged(workspaceId: String)
    case unknown(type: String, payload: [String: AnyCodable])
}

// MARK: - Parsing

extension ServerEvent {

    /// Parse a `ServerEvent` from the first arg of a `session:event` envelope.
    ///
    /// The server sends `args: [SessionEvent]` where `SessionEvent` is a
    /// discriminated union keyed on `type`.
    public static func from(eventPayload payload: [String: AnyCodable]) -> ServerEvent? {
        guard let typeValue = payload["type"]?.stringValue else { return nil }
        let sid = payload["sessionId"]?.stringValue ?? ""

        switch typeValue {
        case "text_delta":
            return .textDelta(
                sessionId: sid,
                delta: payload["delta"]?.stringValue ?? "",
                turnId: payload["turnId"]?.stringValue
            )

        case "text_complete":
            return .textComplete(
                sessionId: sid,
                text: payload["text"]?.stringValue ?? "",
                turnId: payload["turnId"]?.stringValue,
                messageId: payload["messageId"]?.stringValue
            )

        case "user_message":
            guard let msgDict = payload["message"]?.dictionaryValue,
                  let msg = decodeFromAnyCodable(Message.self, dict: msgDict) else {
                return nil
            }
            return .userMessage(
                sessionId: sid,
                message: msg,
                status: payload["status"]?.stringValue ?? "accepted"
            )

        case "tool_start":
            return .toolStart(
                sessionId: sid,
                toolName: payload["toolName"]?.stringValue ?? "",
                toolUseId: payload["toolUseId"]?.stringValue ?? "",
                toolInput: payload["toolInput"]?.dictionaryValue,
                turnId: payload["turnId"]?.stringValue
            )

        case "tool_result":
            return .toolResult(
                sessionId: sid,
                toolUseId: payload["toolUseId"]?.stringValue ?? "",
                toolName: payload["toolName"]?.stringValue,
                result: payload["result"]?.stringValue ?? "",
                isError: payload["isError"]?.boolValue ?? false,
                turnId: payload["turnId"]?.stringValue
            )

        case "task_progress":
            return .taskProgress(
                sessionId: sid,
                toolUseId: payload["toolUseId"]?.stringValue ?? "",
                elapsedSeconds: payload["elapsedSeconds"]?.doubleValue ?? 0
            )

        case "permission_request":
            guard let reqDict = payload["request"]?.dictionaryValue,
                  let req = decodeFromAnyCodable(PermissionRequestData.self, dict: reqDict) else {
                return nil
            }
            return .permissionRequest(sessionId: sid, request: req)

        case "credential_request":
            guard let reqDict = payload["request"]?.dictionaryValue,
                  let req = decodeFromAnyCodable(CredentialRequestData.self, dict: reqDict) else {
                return nil
            }
            return .credentialRequest(sessionId: sid, request: req)

        case "complete":
            let usage: TokenUsage?
            if let usageDict = payload["tokenUsage"]?.dictionaryValue {
                usage = decodeFromAnyCodable(TokenUsage.self, dict: usageDict)
            } else {
                usage = nil
            }
            return .complete(sessionId: sid, tokenUsage: usage)

        case "interrupted":
            return .interrupted(sessionId: sid)

        case "error":
            return .error(sessionId: sid, message: payload["error"]?.stringValue ?? "Unknown error")

        case "typed_error":
            let errorMsg = payload["error"]?.dictionaryValue?["message"]?.stringValue ?? "Unknown error"
            return .error(sessionId: sid, message: errorMsg)

        case "status":
            return .status(
                sessionId: sid,
                message: payload["message"]?.stringValue ?? "",
                statusType: payload["statusType"]?.stringValue
            )

        case "info":
            return .info(
                sessionId: sid,
                message: payload["message"]?.stringValue ?? "",
                level: payload["level"]?.stringValue
            )

        case "name_changed":
            return .nameChanged(sessionId: sid, name: payload["name"]?.stringValue)

        case "title_generated":
            return .titleGenerated(
                sessionId: sid,
                title: payload["title"]?.stringValue ?? ""
            )

        case "session_flagged":
            return .sessionFlagged(sessionId: sid)

        case "session_unflagged":
            return .sessionUnflagged(sessionId: sid)

        case "session_archived":
            return .sessionArchived(sessionId: sid)

        case "session_unarchived":
            return .sessionUnarchived(sessionId: sid)

        case "permission_mode_changed":
            return .permissionModeChanged(
                sessionId: sid,
                mode: payload["permissionMode"]?.stringValue ?? "",
                previousMode: payload["previousPermissionMode"]?.stringValue
            )

        case "session_created":
            return .sessionCreated(sessionId: sid)

        case "session_deleted":
            return .sessionDeleted(sessionId: sid)

        case "session_status_changed":
            return .sessionStatusChanged(
                sessionId: sid,
                sessionStatus: payload["sessionStatus"]?.stringValue ?? ""
            )

        case "session_model_changed":
            return .sessionModelChanged(sessionId: sid, model: payload["model"]?.stringValue)

        case "working_directory_changed":
            return .workingDirectoryChanged(
                sessionId: sid,
                workingDirectory: payload["workingDirectory"]?.stringValue ?? ""
            )

        case "plan_submitted":
            guard let msgDict = payload["message"]?.dictionaryValue,
                  let msg = decodeFromAnyCodable(Message.self, dict: msgDict) else {
                return nil
            }
            return .planSubmitted(sessionId: sid, message: msg)

        case "task_backgrounded":
            return .taskBackgrounded(
                sessionId: sid,
                toolUseId: payload["toolUseId"]?.stringValue ?? "",
                taskId: payload["taskId"]?.stringValue ?? "",
                intent: payload["intent"]?.stringValue
            )

        case "task_completed":
            return .taskCompleted(
                sessionId: sid,
                taskId: payload["taskId"]?.stringValue ?? "",
                status: payload["status"]?.stringValue ?? "completed"
            )

        case "sources_changed":
            let slugs = payload["enabledSourceSlugs"]?.arrayValue?.compactMap(\.stringValue) ?? []
            return .sourcesChanged(sessionId: sid, enabledSourceSlugs: slugs)

        case "labels_changed":
            let labels = payload["labels"]?.arrayValue?.compactMap(\.stringValue) ?? []
            return .labelsChanged(sessionId: sid, labels: labels)

        case "connection_changed":
            return .connectionChanged(
                sessionId: sid,
                connectionSlug: payload["connectionSlug"]?.stringValue ?? ""
            )

        case "usage_update":
            let usageDict = payload["tokenUsage"]?.dictionaryValue
            return .usageUpdate(
                sessionId: sid,
                inputTokens: usageDict?["inputTokens"]?.intValue,
                contextWindow: usageDict?["contextWindow"]?.intValue
            )

        case "async_operation":
            return .asyncOperation(
                sessionId: sid,
                isOngoing: payload["isOngoing"]?.boolValue ?? false
            )

        default:
            return .unknown(type: typeValue, payload: payload)
        }
    }
}

// MARK: - Helpers

/// Decode a `Codable` type from an `AnyCodable` dictionary by re-encoding to JSON.
private func decodeFromAnyCodable<T: Decodable>(_ type: T.Type, dict: [String: AnyCodable]) -> T? {
    guard let data = try? JSONEncoder().encode(dict) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
}
