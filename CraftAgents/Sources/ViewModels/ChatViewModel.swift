// SPDX-License-Identifier: MIT

import Foundation
import Combine

// MARK: - ChatViewModel

/// Manages a single chat session, including message history,
/// user input, streaming assistant responses, and server events.
@MainActor @Observable
final class ChatViewModel {

    // MARK: - State

    var session: Session
    var messages: [Message] = []
    var inputText = ""
    var isProcessing = false
    var statusMessage: String?
    var streamingText = ""
    var errorMessage: String?

    // MARK: - Private

    private let rpcClient: RPCClient
    private var cancellables = Set<AnyCancellable>()
    private var currentTurnId: String?

    // MARK: - Init

    /// - Parameters:
    ///   - session: The session this view model manages.
    ///   - rpcClient: The shared RPC client.
    init(session: Session, rpcClient: RPCClient) {
        self.session = session
        self.rpcClient = rpcClient
        subscribeToEvents()
    }

    // MARK: - Actions

    /// Load the full message history for this session.
    func loadMessages() async {
        do {
            let raw: AnyCodable = try await rpcClient.getMessages(sessionId: session.id)
            if let data = try? JSONEncoder().encode(raw),
               let decoded = try? JSONDecoder().decode([Message].self, from: data) {
                messages = decoded
            }
        } catch {
            errorMessage = "Failed to load messages: \(error.localizedDescription)"
        }
    }

    /// Send the current input text as a user message.
    func sendMessage() async {
        let content = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        // Optimistic local insert
        let userMessage = Message(
            role: .user,
            content: content,
            timestamp: Date().timeIntervalSince1970
        )
        messages.append(userMessage)
        inputText = ""
        isProcessing = true
        streamingText = ""
        errorMessage = nil
        statusMessage = nil

        do {
            _ = try await rpcClient.sendMessage(sessionId: session.id, content: content)
        } catch {
            errorMessage = "Failed to send message: \(error.localizedDescription)"
            isProcessing = false
        }
    }

    /// Cancel the currently processing assistant turn.
    func cancelProcessing() async {
        guard isProcessing else { return }
        do {
            _ = try await rpcClient.cancelSession(sessionId: session.id)
        } catch {
            errorMessage = "Failed to cancel: \(error.localizedDescription)"
        }
    }

    // MARK: - Event handling

    /// Process a single server event. Called both from the Combine
    /// subscription and can be invoked externally for testing.
    func handleEvent(_ event: ServerEvent) {
        // Only handle events for this session
        guard eventSessionId(event) == session.id else { return }

        switch event {
        case .textDelta(_, let delta, let turnId):
            currentTurnId = turnId
            streamingText += delta
            isProcessing = true

        case .textComplete(_, let text, let turnId, let messageId):
            let assistantMessage = Message(
                id: messageId ?? UUID().uuidString,
                role: .assistant,
                content: text,
                timestamp: Date().timeIntervalSince1970,
                turnId: turnId
            )
            messages.append(assistantMessage)
            streamingText = ""
            currentTurnId = nil

        case .userMessage(_, let message, _):
            // Replace optimistic insert or add if not present
            if let idx = messages.lastIndex(where: {
                $0.role == .user && $0.content == message.content && $0.isPending != false
            }) {
                messages[idx] = message
            } else if !messages.contains(where: { $0.id == message.id }) {
                messages.append(message)
            }

        case .toolStart(_, let toolName, let toolUseId, let toolInput, let turnId):
            let toolMessage = Message(
                role: .tool,
                toolName: toolName,
                toolUseId: toolUseId,
                toolInput: toolInput,
                toolStatus: .executing,
                turnId: turnId
            )
            messages.append(toolMessage)

        case .toolResult(_, let toolUseId, _, let result, let isError, _):
            if let idx = messages.lastIndex(where: { $0.toolUseId == toolUseId }) {
                messages[idx].toolResult = result
                messages[idx].toolStatus = isError ? .error : .completed
            }

        case .status(_, let message, _):
            statusMessage = message

        case .error(_, let message):
            errorMessage = message
            isProcessing = false
            streamingText = ""

        case .complete(_, let tokenUsage):
            isProcessing = false
            streamingText = ""
            statusMessage = nil
            session.tokenUsage = tokenUsage
            session.isProcessing = false

        case .interrupted:
            isProcessing = false
            streamingText = ""
            statusMessage = "Processing was interrupted."

        case .nameChanged(_, let name):
            session.name = name

        case .titleGenerated(_, let title):
            session.name = title

        case .sessionStatusChanged(_, let status):
            session.sessionStatus = status

        default:
            break
        }
    }

    // MARK: - Subscription

    private func subscribeToEvents() {
        rpcClient.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.handleEvent(event)
            }
            .store(in: &cancellables)
    }

    // MARK: - Helpers

    /// Extract the session ID from any server event.
    private func eventSessionId(_ event: ServerEvent) -> String? {
        switch event {
        case .textDelta(let sid, _, _),
             .textComplete(let sid, _, _, _),
             .userMessage(let sid, _, _),
             .toolStart(let sid, _, _, _, _),
             .toolResult(let sid, _, _, _, _, _),
             .toolProgress(let sid, _, _, _),
             .permissionRequest(let sid, _),
             .credentialRequest(let sid, _),
             .complete(let sid, _),
             .interrupted(let sid),
             .error(let sid, _),
             .status(let sid, _, _),
             .info(let sid, _, _),
             .nameChanged(let sid, _),
             .titleGenerated(let sid, _),
             .sessionFlagged(let sid),
             .sessionUnflagged(let sid),
             .sessionArchived(let sid),
             .sessionUnarchived(let sid),
             .permissionModeChanged(let sid, _, _),
             .sessionCreated(let sid),
             .sessionDeleted(let sid),
             .sessionStatusChanged(let sid, _),
             .sessionModelChanged(let sid, _),
             .workingDirectoryChanged(let sid, _),
             .planSubmitted(let sid, _),
             .taskBackgrounded(let sid, _, _, _),
             .taskProgress(let sid, _, _),
             .taskCompleted(let sid, _, _),
             .sourcesChanged(let sid, _),
             .labelsChanged(let sid, _),
             .connectionChanged(let sid, _),
             .usageUpdate(let sid, _, _),
             .asyncOperation(let sid, _):
            return sid
        case .globalSourcesChanged, .globalSkillsChanged, .unknown:
            return nil
        }
    }
}
