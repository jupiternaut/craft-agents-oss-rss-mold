// SPDX-License-Identifier: MIT

import Foundation

/// Health and version information returned by the server.
public struct ServerStatus: Codable, Sendable {
    public var status: String?
    public var version: String?
    public var uptime: Double?

    public init(status: String? = nil, version: String? = nil, uptime: Double? = nil) {
        self.status = status
        self.version = version
        self.uptime = uptime
    }
}
