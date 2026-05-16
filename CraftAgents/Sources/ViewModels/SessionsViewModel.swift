// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - SessionsViewModel

/// Manages the list of sessions for the current workspace.
///
/// Subscribes to server events to keep the list up-to-date when
/// sessions are created, deleted, renamed, or change status.
@MainActor @Observable
final class SessionsViewModel {

    // MARK: - State

    var sessions: [Session] = []
    var isLoading = false
    var searchQuery = ""
    var errorMessage: String?

    // MARK: - Computed

    /// Sessions filtered by the current search query and sorted newest-first.
    var filteredSessions: [Session] {
        let sorted = sessions.sorted { lhs, rhs in
            (lhs.lastMessageAt ?? 0) > (rhs.lastMessageAt ?? 0)
        }
        guard !searchQuery.isEmpty else { return sorted }
        let query = searchQuery.lowercased()
        return sorted.filter { session in
            (session.name?.lowercased().contains(query) ?? false)
            || (session.preview?.lowercased().contains(query) ?? false)
        }
    }

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

    /// Fetch sessions for the current workspace.
    func loadSessions() async {
        guard let wid = workspaceId() else { return }
        isLoading = true
        errorMessage = nil

        do {
            let raw: AnyCodable = try await rpcClient.getSessions(workspaceId: wid)
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode([Session].self, from: data) {
                sessions = decoded
            }
        } catch {
            errorMessage = "Failed to load sessions: \(error.localizedDescription)"
        }

        isLoading = false
    }

    /// Create a new session and return its ID.
    func createSession() async -> String? {
        guard let wid = workspaceId() else { return nil }
        errorMessage = nil

        do {
            let raw: AnyCodable = try await rpcClient.createSession(workspaceId: wid)

            // The server may return the session object or just the id
            if let dict = raw.dictionaryValue,
               let data = try? JSONEncoder().encode(AnyCodable(dict)),
               let session = try? JSONDecoder().decode(Session.self, from: data) {
                sessions.insert(session, at: 0)
                return session.id
            }
            if let idString = raw.stringValue {
                let stub = Session(id: idString, workspaceId: wid)
                sessions.insert(stub, at: 0)
                return idString
            }
            return nil
        } catch {
            errorMessage = "Failed to create session: \(error.localizedDescription)"
            return nil
        }
    }

    /// Delete a session by ID.
    func deleteSession(_ id: String) async {
        guard let wid = workspaceId() else { return }
        errorMessage = nil

        do {
            _ = try await rpcClient.deleteSession(workspaceId: wid, sessionId: id)
            sessions.removeAll { $0.id == id }
        } catch {
            errorMessage = "Failed to delete session: \(error.localizedDescription)"
        }
    }

    /// Flag / unflag a session for review.
    func flagSession(_ id: String) async {
        errorMessage = nil
        let session = sessions.first { $0.id == id }
        let isFlagged = session?.isFlagged ?? false
        let command = isFlagged ? "unflag" : "flag"

        do {
            _ = try await rpcClient.sessionCommand(
                sessionId: id,
                command: ["action": AnyCodable(command)]
            )
            if let idx = sessions.firstIndex(where: { $0.id == id }) {
                sessions[idx].isFlagged = !isFlagged
            }
        } catch {
            errorMessage = "Failed to \(command) session: \(error.localizedDescription)"
        }
    }

    // MARK: - Event subscription

    private func subscribeToEvents() {
        rpcClient.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.handleEvent(event)
            }
            .store(in: &cancellables)
    }

    private func handleEvent(_ event: ServerEvent) {
        switch event {
        case .sessionCreated(let sid):
            if !sessions.contains(where: { $0.id == sid }) {
                let stub = Session(id: sid, workspaceId: workspaceId() ?? "")
                sessions.insert(stub, at: 0)
            }

        case .sessionDeleted(let sid):
            sessions.removeAll { $0.id == sid }

        case .nameChanged(let sid, let name):
            if let idx = sessions.firstIndex(where: { $0.id == sid }) {
                sessions[idx].name = name
            }

        case .titleGenerated(let sid, let title):
            if let idx = sessions.firstIndex(where: { $0.id == sid }) {
                sessions[idx].name = title
            }

        case .sessionFlagged(let sid):
            if let idx = sessions.firstIndex(where: { $0.id == sid }) {
                sessions[idx].isFlagged = true
            }

        case .sessionUnflagged(let sid):
            if let idx = sessions.firstIndex(where: { $0.id == sid }) {
                sessions[idx].isFlagged = false
            }

        case .sessionStatusChanged(let sid, let status):
            if let idx = sessions.firstIndex(where: { $0.id == sid }) {
                sessions[idx].sessionStatus = status
            }

        case .complete(let sid, _),
             .interrupted(let sid):
            if let idx = sessions.firstIndex(where: { $0.id == sid }) {
                sessions[idx].isProcessing = false
            }

        case .textDelta(let sid, _, _):
            if let idx = sessions.firstIndex(where: { $0.id == sid }) {
                sessions[idx].isProcessing = true
                sessions[idx].lastMessageAt = Date().timeIntervalSince1970
            }

        default:
            break
        }
    }
}
