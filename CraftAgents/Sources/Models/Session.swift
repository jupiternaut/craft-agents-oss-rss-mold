// SPDX-License-Identifier: MIT

import Foundation

/// A chat session managed by the Craft Agents server.
///
/// Decoded from `sessions:get` / `sessions:create` RPC responses.
/// The `messages` array is populated separately via `sessions:getMessages`
/// and is excluded from the default `Codable` round-trip.
public struct Session: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var workspaceId: String
    public var name: String?
    public var lastMessageAt: Double?
    public var isProcessing: Bool
    public var hasUnread: Bool
    public var isFlagged: Bool
    /// Permission mode: `"safe"`, `"ask"`, or `"allow-all"`.
    public var permissionMode: String?
    public var sessionStatus: String?
    public var labels: [String]
    public var model: String?
    public var llmConnection: String?
    public var thinkingLevel: String?
    public var tokenUsage: TokenUsage?
    public var createdAt: Double?
    public var messageCount: Int?
    public var preview: String?

    /// Messages within this session – populated by the client, not decoded from the server list.
    public var messages: [Message]

    // MARK: - Init

    public init(
        id: String = UUID().uuidString,
        workspaceId: String = "",
        name: String? = nil,
        lastMessageAt: Double? = nil,
        isProcessing: Bool = false,
        hasUnread: Bool = false,
        isFlagged: Bool = false,
        permissionMode: String? = nil,
        sessionStatus: String? = nil,
        labels: [String] = [],
        model: String? = nil,
        llmConnection: String? = nil,
        thinkingLevel: String? = nil,
        tokenUsage: TokenUsage? = nil,
        createdAt: Double? = nil,
        messageCount: Int? = nil,
        preview: String? = nil,
        messages: [Message] = []
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.name = name
        self.lastMessageAt = lastMessageAt
        self.isProcessing = isProcessing
        self.hasUnread = hasUnread
        self.isFlagged = isFlagged
        self.permissionMode = permissionMode
        self.sessionStatus = sessionStatus
        self.labels = labels
        self.model = model
        self.llmConnection = llmConnection
        self.thinkingLevel = thinkingLevel
        self.tokenUsage = tokenUsage
        self.createdAt = createdAt
        self.messageCount = messageCount
        self.preview = preview
        self.messages = messages
    }

    // MARK: - CodingKeys (excludes `messages` which is populated separately)

    enum CodingKeys: String, CodingKey {
        case id, workspaceId, name, lastMessageAt
        case isProcessing, hasUnread, isFlagged
        case permissionMode, sessionStatus, labels
        case model, llmConnection, thinkingLevel, tokenUsage
        case createdAt, messageCount, preview
    }

    // MARK: - Custom Decoding

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name)
        lastMessageAt = try c.decodeIfPresent(Double.self, forKey: .lastMessageAt)
        isProcessing = try c.decodeIfPresent(Bool.self, forKey: .isProcessing) ?? false
        hasUnread = try c.decodeIfPresent(Bool.self, forKey: .hasUnread) ?? false
        isFlagged = try c.decodeIfPresent(Bool.self, forKey: .isFlagged) ?? false
        permissionMode = try c.decodeIfPresent(String.self, forKey: .permissionMode)
        sessionStatus = try c.decodeIfPresent(String.self, forKey: .sessionStatus)
        labels = try c.decodeIfPresent([String].self, forKey: .labels) ?? []
        model = try c.decodeIfPresent(String.self, forKey: .model)
        llmConnection = try c.decodeIfPresent(String.self, forKey: .llmConnection)
        thinkingLevel = try c.decodeIfPresent(String.self, forKey: .thinkingLevel)
        tokenUsage = try c.decodeIfPresent(TokenUsage.self, forKey: .tokenUsage)
        createdAt = try c.decodeIfPresent(Double.self, forKey: .createdAt)
        messageCount = try c.decodeIfPresent(Int.self, forKey: .messageCount)
        preview = try c.decodeIfPresent(String.self, forKey: .preview)
        messages = []
    }
}
