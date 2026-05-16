// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - SkillsViewModel

/// Manages the list of reusable skills available in the current workspace.
///
/// Subscribes to `globalSkillsChanged` events so the UI refreshes
/// when skills are added or modified on the server.
@MainActor @Observable
final class SkillsViewModel {

    // MARK: - State

    var skills: [Skill] = []
    var isLoading = false
    var errorMessage: String?

    // MARK: - Dependencies

    private let rpcClient: RPCClient
    private let workspaceId: () -> String?
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init

    /// - Parameters:
    ///   - rpcClient: The shared RPC client.
    ///   - workspaceId: A closure returning the current workspace ID.
    init(rpcClient: RPCClient, workspaceId: @escaping () -> String?) {
        self.rpcClient = rpcClient
        self.workspaceId = workspaceId
        subscribeToEvents()
    }

    // MARK: - Actions

    /// Fetch skills for the current workspace.
    func loadSkills() async {
        guard let wid = workspaceId() else { return }
        isLoading = true
        errorMessage = nil

        do {
            let raw: AnyCodable = try await rpcClient.request(
                channel: "skills:get",
                args: [AnyCodable(wid)]
            )
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode([Skill].self, from: data) {
                skills = decoded
            }
        } catch {
            errorMessage = "Failed to load skills: \(error.localizedDescription)"
        }

        isLoading = false
    }

    // MARK: - Subscription

    private func subscribeToEvents() {
        rpcClient.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                if case .globalSkillsChanged = event {
                    Task { await self.loadSkills() }
                }
            }
            .store(in: &cancellables)
    }
}
