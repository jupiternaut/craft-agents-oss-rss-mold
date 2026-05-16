// SPDX-License-Identifier: MIT

import Foundation

/// A configured LLM provider connection (e.g. Anthropic, OpenAI).
public struct LLMConnection: Identifiable, Codable, Hashable, Sendable {
    public var id: String { slug }
    public var slug: String
    public var name: String
    public var provider: String?
    public var models: [LLMModel]?
    public var isDefault: Bool?

    public init(
        slug: String,
        name: String,
        provider: String? = nil,
        models: [LLMModel]? = nil,
        isDefault: Bool? = nil
    ) {
        self.slug = slug
        self.name = name
        self.provider = provider
        self.models = models
        self.isDefault = isDefault
    }

    enum CodingKeys: String, CodingKey {
        case slug, name, provider, models, isDefault
    }
}

/// A single model available through an LLM connection.
public struct LLMModel: Codable, Hashable, Sendable, Identifiable {
    public var id: String { modelId }
    public var modelId: String
    public var name: String?
    public var provider: String?

    public init(modelId: String, name: String? = nil, provider: String? = nil) {
        self.modelId = modelId
        self.name = name
        self.provider = provider
    }

    enum CodingKeys: String, CodingKey {
        case modelId, name, provider
    }
}
