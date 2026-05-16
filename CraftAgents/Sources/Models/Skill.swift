// SPDX-License-Identifier: MIT

import Foundation

/// A reusable skill (prompt template with tool permissions) available in the workspace.
public struct Skill: Identifiable, Codable, Hashable, Sendable {
    public var id: String { slug }
    public var slug: String
    public var name: String
    public var description: String?
    public var icon: String?
    public var globs: [String]?
    public var alwaysAllow: [String]?
    public var requiredSources: [String]?
    public var content: String?

    public init(
        slug: String,
        name: String,
        description: String? = nil,
        icon: String? = nil,
        globs: [String]? = nil,
        alwaysAllow: [String]? = nil,
        requiredSources: [String]? = nil,
        content: String? = nil
    ) {
        self.slug = slug
        self.name = name
        self.description = description
        self.icon = icon
        self.globs = globs
        self.alwaysAllow = alwaysAllow
        self.requiredSources = requiredSources
        self.content = content
    }

    enum CodingKeys: String, CodingKey {
        case slug, name, description, icon, globs, alwaysAllow, requiredSources, content
    }
}
