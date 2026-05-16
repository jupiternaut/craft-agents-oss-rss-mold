// SPDX-License-Identifier: MIT

import Foundation

/// A workspace grouping sessions and configuration on the server.
public struct Workspace: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var rootPath: String?
    public var slug: String?

    public init(id: String = UUID().uuidString, name: String = "", rootPath: String? = nil, slug: String? = nil) {
        self.id = id
        self.name = name
        self.rootPath = rootPath
        self.slug = slug
    }

    enum CodingKeys: String, CodingKey {
        case id, name, rootPath, slug
    }
}
