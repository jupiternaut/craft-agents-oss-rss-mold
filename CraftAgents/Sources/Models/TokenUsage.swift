// SPDX-License-Identifier: MIT

import Foundation

/// Snapshot of LLM token consumption for a session or turn.
public struct TokenUsage: Codable, Hashable, Sendable {
    public var inputTokens: Int?
    public var outputTokens: Int?
    public var totalTokens: Int?
    public var contextTokens: Int?
    public var costUsd: Double?
    public var cacheReadTokens: Int?
    public var cacheCreationTokens: Int?
    public var contextWindow: Int?

    public init(
        inputTokens: Int? = nil,
        outputTokens: Int? = nil,
        totalTokens: Int? = nil,
        contextTokens: Int? = nil,
        costUsd: Double? = nil,
        cacheReadTokens: Int? = nil,
        cacheCreationTokens: Int? = nil,
        contextWindow: Int? = nil
    ) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.totalTokens = totalTokens
        self.contextTokens = contextTokens
        self.costUsd = costUsd
        self.cacheReadTokens = cacheReadTokens
        self.cacheCreationTokens = cacheCreationTokens
        self.contextWindow = contextWindow
    }

    // MARK: - CodingKeys (supports both camelCase and snake_case via convertFromSnakeCase)

    enum CodingKeys: String, CodingKey {
        case inputTokens
        case outputTokens
        case totalTokens
        case contextTokens
        case costUsd
        case cacheReadTokens
        case cacheCreationTokens
        case contextWindow
    }
}
