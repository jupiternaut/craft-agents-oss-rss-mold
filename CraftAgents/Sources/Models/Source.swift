// SPDX-License-Identifier: MIT

import Foundation

/// An external data source (MCP server, API, or local integration) connected to the workspace.
public struct Source: Identifiable, Codable, Hashable, Sendable {
    public var id: String { slug }
    public var slug: String
    public var name: String
    public var type: SourceType?
    public var description: String?
    public var iconUrl: String?
    public var isConnected: Bool?
    public var toolCount: Int?
    public var tools: [SourceTool]?

    public init(
        slug: String,
        name: String,
        type: SourceType? = nil,
        description: String? = nil,
        iconUrl: String? = nil,
        isConnected: Bool? = nil,
        toolCount: Int? = nil,
        tools: [SourceTool]? = nil
    ) {
        self.slug = slug
        self.name = name
        self.type = type
        self.description = description
        self.iconUrl = iconUrl
        self.isConnected = isConnected
        self.toolCount = toolCount
        self.tools = tools
    }

    enum CodingKeys: String, CodingKey {
        case slug, name, type, description, iconUrl, isConnected, toolCount, tools
    }
}

// MARK: - SourceType

/// The integration type of a source.
public enum SourceType: String, Codable, Hashable, Sendable {
    case mcp
    case api
    case local
    case unknown

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        self = SourceType(rawValue: value) ?? .unknown
    }
}

// MARK: - SourceTool

/// A single tool exposed by a source.
public struct SourceTool: Codable, Hashable, Sendable, Identifiable {
    public var id: String { name }
    public var name: String
    public var description: String?

    public init(name: String, description: String? = nil) {
        self.name = name
        self.description = description
    }

    enum CodingKeys: String, CodingKey {
        case name, description
    }
}
