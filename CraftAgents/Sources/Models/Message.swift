// SPDX-License-Identifier: MIT

import Foundation

// MARK: - Message

/// A single message within a session conversation.
///
/// Covers user messages, assistant responses, tool invocations/results,
/// errors, plans, and auth requests. All optional fields default to `nil`,
/// making the type safe to decode from both minimal wire DTOs and full
/// persistence payloads.
public struct Message: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var role: MessageRole
    public var content: String
    public var timestamp: Double?

    // Tool fields
    public var toolName: String?
    public var toolUseId: String?
    public var toolInput: [String: AnyCodable]?
    public var toolResult: String?
    public var toolStatus: ToolStatus?
    public var toolDisplayMeta: ToolDisplayMeta?
    public var parentToolUseId: String?

    // Attachments
    public var attachments: [StoredAttachment]?
    public var badges: [ContentBadge]?

    // Metadata
    public var isStreaming: Bool?
    public var isPending: Bool?
    public var isQueued: Bool?
    public var isIntermediate: Bool?
    public var turnId: String?

    // Error fields
    public var errorCode: String?
    public var errorTitle: String?
    public var errorDetails: [String]?

    // Auth request fields
    public var authRequestId: String?
    public var authRequestType: String?
    public var authStatus: String?
    public var authSourceSlug: String?

    public init(
        id: String = UUID().uuidString,
        role: MessageRole = .user,
        content: String = "",
        timestamp: Double? = nil,
        toolName: String? = nil,
        toolUseId: String? = nil,
        toolInput: [String: AnyCodable]? = nil,
        toolResult: String? = nil,
        toolStatus: ToolStatus? = nil,
        toolDisplayMeta: ToolDisplayMeta? = nil,
        parentToolUseId: String? = nil,
        attachments: [StoredAttachment]? = nil,
        badges: [ContentBadge]? = nil,
        isStreaming: Bool? = nil,
        isPending: Bool? = nil,
        isQueued: Bool? = nil,
        isIntermediate: Bool? = nil,
        turnId: String? = nil,
        errorCode: String? = nil,
        errorTitle: String? = nil,
        errorDetails: [String]? = nil,
        authRequestId: String? = nil,
        authRequestType: String? = nil,
        authStatus: String? = nil,
        authSourceSlug: String? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.toolName = toolName
        self.toolUseId = toolUseId
        self.toolInput = toolInput
        self.toolResult = toolResult
        self.toolStatus = toolStatus
        self.toolDisplayMeta = toolDisplayMeta
        self.parentToolUseId = parentToolUseId
        self.attachments = attachments
        self.badges = badges
        self.isStreaming = isStreaming
        self.isPending = isPending
        self.isQueued = isQueued
        self.isIntermediate = isIntermediate
        self.turnId = turnId
        self.errorCode = errorCode
        self.errorTitle = errorTitle
        self.errorDetails = errorDetails
        self.authRequestId = authRequestId
        self.authRequestType = authRequestType
        self.authStatus = authStatus
        self.authSourceSlug = authSourceSlug
    }

    // MARK: - CodingKeys

    enum CodingKeys: String, CodingKey {
        case id, role, content, timestamp
        case toolName, toolUseId, toolInput, toolResult, toolStatus
        case toolDisplayMeta, parentToolUseId
        case attachments, badges
        case isStreaming, isPending, isQueued, isIntermediate, turnId
        case errorCode, errorTitle, errorDetails
        case authRequestId, authRequestType, authStatus, authSourceSlug
    }
}

// MARK: - MessageRole

/// The role of a message in a conversation turn.
public enum MessageRole: String, Codable, Hashable, Sendable {
    case user
    case assistant
    case tool
    case error
    case plan
    case authRequest = "auth-request"
    case system
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        self = MessageRole(rawValue: value) ?? .unknown
    }
}

// MARK: - ToolStatus

/// Lifecycle status of a tool invocation.
public enum ToolStatus: String, Codable, Hashable, Sendable {
    case pending
    case executing
    case completed
    case error
    case backgrounded
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        self = ToolStatus(rawValue: value) ?? .unknown
    }
}

// MARK: - ToolDisplayMeta

/// Presentation metadata for a tool shown in the chat UI.
public struct ToolDisplayMeta: Codable, Hashable, Sendable {
    public var displayName: String?
    public var iconDataUrl: String?
    /// Category hint: `"skill"`, `"source"`, `"native"`, or `"mcp"`.
    public var category: String?

    public init(displayName: String? = nil, iconDataUrl: String? = nil, category: String? = nil) {
        self.displayName = displayName
        self.iconDataUrl = iconDataUrl
        self.category = category
    }
}

// MARK: - StoredAttachment

/// A file attachment stored on the server.
public struct StoredAttachment: Codable, Hashable, Sendable, Identifiable {
    public var id: String { storedPath ?? UUID().uuidString }
    public var type: String?
    public var mimeType: String?
    public var storedPath: String?
    public var fileName: String?
    public var size: Int?

    public init(
        type: String? = nil,
        mimeType: String? = nil,
        storedPath: String? = nil,
        fileName: String? = nil,
        size: Int? = nil
    ) {
        self.type = type
        self.mimeType = mimeType
        self.storedPath = storedPath
        self.fileName = fileName
        self.size = size
    }

    enum CodingKeys: String, CodingKey {
        case type, mimeType, storedPath, fileName, size
    }
}

// MARK: - ContentBadge

/// A small label badge attached to a message (e.g. source attribution).
public struct ContentBadge: Codable, Hashable, Sendable {
    public var type: String?
    public var label: String?
    public var slug: String?

    public init(type: String? = nil, label: String? = nil, slug: String? = nil) {
        self.type = type
        self.label = label
        self.slug = slug
    }
}
