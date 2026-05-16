// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - UserDefaults keys

private enum DefaultsKey {
    static let serverURL = "craftAgents.serverURL"
    static let authToken = "craftAgents.authToken"
    static let workspaceId = "craftAgents.workspaceId"
}

// MARK: - AppViewModel

/// Root application state that owns the ``RPCClient`` and manages
/// connection lifecycle, workspace selection, and server status.
@MainActor @Observable
final class AppViewModel {

    // MARK: - Dependencies

    let rpcClient: RPCClient

    // MARK: - Published state

    var connectionState: ConnectionState = .disconnected
    var workspaces: [Workspace] = []
    var serverStatus: ServerStatus?
    var isConnecting = false
    var errorMessage: String?

    // MARK: - Persisted settings

    var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: DefaultsKey.serverURL) }
    }

    var authToken: String {
        didSet { UserDefaults.standard.set(authToken, forKey: DefaultsKey.authToken) }
    }

    var currentWorkspaceId: String? {
        didSet { UserDefaults.standard.set(currentWorkspaceId, forKey: DefaultsKey.workspaceId) }
    }

    // MARK: - Computed

    var currentWorkspace: Workspace? {
        guard let wid = currentWorkspaceId else { return nil }
        return workspaces.first { $0.id == wid }
    }

    var isConnected: Bool {
        connectionState == .connected
    }

    // MARK: - Private

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init

    init(rpcClient: RPCClient = RPCClient()) {
        self.rpcClient = rpcClient
        self.serverURL = UserDefaults.standard.string(forKey: DefaultsKey.serverURL) ?? ""
        self.authToken = UserDefaults.standard.string(forKey: DefaultsKey.authToken) ?? ""
        self.currentWorkspaceId = UserDefaults.standard.string(forKey: DefaultsKey.workspaceId)

        subscribeToConnectionState()
    }

    // MARK: - Connection

    /// Connect to the Craft Agents server using the stored URL and token.
    func connect() async {
        guard !serverURL.isEmpty else {
            errorMessage = "Server URL is required."
            return
        }
        guard let url = URL(string: serverURL) else {
            errorMessage = "Invalid server URL."
            return
        }

        isConnecting = true
        errorMessage = nil

        do {
            let token = authToken.isEmpty ? nil : authToken
            let workspace = currentWorkspaceId ?? ""
            try await rpcClient.connect(url: url, token: token, workspaceId: workspace)
            await loadWorkspaces()
            await loadServerStatus()
        } catch {
            errorMessage = error.localizedDescription
        }

        isConnecting = false
    }

    /// Disconnect from the server and reset transient state.
    func disconnect() {
        Task {
            await rpcClient.disconnect()
        }
        workspaces = []
        serverStatus = nil
        errorMessage = nil
    }

    // MARK: - Workspaces

    /// Fetch available workspaces from the server.
    func loadWorkspaces() async {
        do {
            let raw: AnyCodable = try await rpcClient.request(
                channel: "workspaces:get",
                args: []
            )
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode([Workspace].self, from: data) {
                workspaces = decoded
            }
            // Auto-select first workspace if none selected
            if currentWorkspaceId == nil, let first = workspaces.first {
                currentWorkspaceId = first.id
            }
        } catch {
            errorMessage = "Failed to load workspaces: \(error.localizedDescription)"
        }
    }

    /// Select a workspace and persist the choice.
    func selectWorkspace(_ id: String) async {
        currentWorkspaceId = id
    }

    // MARK: - Server status

    private func loadServerStatus() async {
        do {
            let raw: AnyCodable = try await rpcClient.getServerStatus()
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode(ServerStatus.self, from: data) {
                serverStatus = decoded
            }
        } catch {
            // Non-critical — don't surface to user
        }
    }

    // MARK: - Subscriptions

    private func subscribeToConnectionState() {
        rpcClient.connectionState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.connectionState = state
            }
            .store(in: &cancellables)
    }
}
