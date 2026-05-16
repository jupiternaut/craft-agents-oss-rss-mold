// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - SourcesViewModel

/// Manages the list of external data sources for the current workspace.
///
/// Subscribes to `globalSourcesChanged` events so the UI stays
/// up-to-date when sources are added or removed on the server.
@MainActor @Observable
final class SourcesViewModel {

    // MARK: - State

    var sources: [Source] = []
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

    /// Fetch sources for the current workspace.
    func loadSources() async {
        guard let wid = workspaceId() else { return }
        isLoading = true
        errorMessage = nil

        do {
            let raw: AnyCodable = try await rpcClient.request(
                channel: "sources:get",
                args: [AnyCodable(wid)]
            )
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode([Source].self, from: data) {
                sources = decoded
            }
        } catch {
            errorMessage = "Failed to load sources: \(error.localizedDescription)"
        }

        isLoading = false
    }

    // MARK: - Subscription

    private func subscribeToEvents() {
        rpcClient.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                if case .globalSourcesChanged = event {
                    Task { await self.loadSources() }
                }
            }
            .store(in: &cancellables)
    }
}
