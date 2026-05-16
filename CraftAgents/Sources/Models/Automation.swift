// SPDX-License-Identifier: MIT

import Foundation

/// A scheduled or event-driven automation in the workspace.
public struct Automation: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public var name: String
    public var description: String?
    public var isEnabled: Bool
    public var trigger: String?
    public var schedule: String?
    public var lastRunAt: Double?

    public init(
        id: String = UUID().uuidString,
        name: String = "",
        description: String? = nil,
        isEnabled: Bool = true,
        trigger: String? = nil,
        schedule: String? = nil,
        lastRunAt: Double? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.isEnabled = isEnabled
        self.trigger = trigger
        self.schedule = schedule
        self.lastRunAt = lastRunAt
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, isEnabled, trigger, schedule, lastRunAt
    }
}
