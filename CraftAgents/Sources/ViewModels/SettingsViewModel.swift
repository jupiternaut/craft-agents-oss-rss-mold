// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - SettingsViewModel

/// Manages server configuration data — LLM connections,
/// automations, and server status.
@MainActor @Observable
final class SettingsViewModel {

    // MARK: - State

    var llmConnections: [LLMConnection] = []
    var automations: [Automation] = []
    var serverStatus: ServerStatus?
    var isLoading = false
    var errorMessage: String?

    // MARK: - Dependencies

    private let rpcClient: RPCClient
    private let workspaceId: () -> String?

    // MARK: - Init

    /// - Parameters:
    ///   - rpcClient: The shared RPC client.
    ///   - workspaceId: A closure returning the current workspace ID.
    init(rpcClient: RPCClient, workspaceId: @escaping () -> String?) {
        self.rpcClient = rpcClient
        self.workspaceId = workspaceId
    }

    // MARK: - Actions

    /// Load LLM connections and server status concurrently.
    func loadSettings() async {
        isLoading = true
        errorMessage = nil

        async let connectionsResult: Void = loadLLMConnections()
        async let statusResult: Void = loadServerStatus()

        _ = await (connectionsResult, statusResult)

        isLoading = false
    }

    /// Load automations for the current workspace.
    func loadAutomations() async {
        guard let wid = workspaceId() else { return }
        errorMessage = nil

        do {
            let raw: AnyCodable = try await rpcClient.request(
                channel: "automations:get",
                args: [AnyCodable(wid)]
            )
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode([Automation].self, from: data) {
                automations = decoded
            }
        } catch {
            errorMessage = "Failed to load automations: \(error.localizedDescription)"
        }
    }

    // MARK: - Private

    private func loadLLMConnections() async {
        do {
            let raw: AnyCodable = try await rpcClient.request(
                channel: "llm:getConnections",
                args: []
            )
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode([LLMConnection].self, from: data) {
                llmConnections = decoded
            }
        } catch {
            errorMessage = "Failed to load LLM connections: \(error.localizedDescription)"
        }
    }

    private func loadServerStatus() async {
        do {
            let raw: AnyCodable = try await rpcClient.getServerStatus()
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode(ServerStatus.self, from: data) {
                serverStatus = decoded
            }
        } catch {
            // Non-critical — don't overwrite other errors
        }
    }
}
