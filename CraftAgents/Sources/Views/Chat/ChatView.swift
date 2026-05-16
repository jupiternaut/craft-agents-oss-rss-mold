// SPDX-License-Identifier: Apache-2.0

import SwiftUI
import Combine

/// Chat view for a single session with streaming message support.
struct ChatView: View {
    let sessionId: String
    let rpcClient: RPCClient
    var sessionsViewModel: SessionsViewModel?

    @State private var viewModel: ChatViewModel?
    @State private var scrollProxy: ScrollViewProxy?

    var body: some View {
        Group {
            if let vm = viewModel {
                chatContent(vm)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(viewModel?.session.name ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let session = sessionsViewModel?.sessions.first { $0.id == sessionId }
                ?? Session(id: sessionId)
            let vm = ChatViewModel(session: session, rpcClient: rpcClient)
            self.viewModel = vm
            await vm.loadMessages()
        }
    }

    @ViewBuilder
    private func chatContent(_ vm: ChatViewModel) -> some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(vm.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }

                        // Streaming text
                        if !vm.streamingText.isEmpty {
                            StreamingBubble(text: vm.streamingText)
                                .id("streaming")
                        }

                        // Status message
                        if let status = vm.statusMessage {
                            StatusBadge(text: status)
                                .id("status")
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                    .padding(.bottom, 16)
                }
                .onChange(of: vm.messages.count) {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(vm.messages.last?.id ?? "streaming", anchor: .bottom)
                    }
                }
                .onChange(of: vm.streamingText) {
                    proxy.scrollTo("streaming", anchor: .bottom)
                }
            }

            Divider()

            // Input area
            ChatInputBar(vm: vm)
        }
    }
}

// MARK: - Chat Input Bar

private struct ChatInputBar: View {
    @Bindable var vm: ChatViewModel
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message...", text: $vm.inputText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...6)
                .focused($isFocused)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.fill.tertiary, in: .rect(cornerRadius: 20))
                .onSubmit {
                    Task { await vm.sendMessage() }
                }

            if vm.isProcessing {
                Button {
                    Task { await vm.cancelProcessing() }
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.red)
                }
            } else {
                Button {
                    Task { await vm.sendMessage() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundStyle(vm.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .tertiary : .primary)
                }
                .disabled(vm.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: Message

    var body: some View {
        switch message.role {
        case .user:
            userBubble
        case .assistant:
            assistantBubble
        case .tool:
            toolBubble
        case .error:
            errorBubble
        default:
            assistantBubble
        }
    }

    private var userBubble: some View {
        HStack {
            Spacer(minLength: 60)
            Text(message.content)
                .font(.body)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.blue, in: .rect(cornerRadius: 18, style: .continuous))
                .foregroundStyle(.white)
        }
        .padding(.vertical, 2)
    }

    private var assistantBubble: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(message.content)
                    .font(.body)
                    .textSelection(.enabled)

                if let usage = tokenSummary {
                    Text(usage)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.fill.quaternary, in: .rect(cornerRadius: 18, style: .continuous))

            Spacer(minLength: 40)
        }
        .padding(.vertical, 2)
    }

    private var toolBubble: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                // Tool header
                HStack(spacing: 6) {
                    Image(systemName: toolIcon)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text(message.toolDisplayMeta?.displayName ?? message.toolName ?? "Tool")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)

                    Spacer()

                    toolStatusBadge
                }

                // Tool result (collapsed)
                if let result = message.toolResult, !result.isEmpty {
                    Text(result)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.fill.quinary, in: .rect(cornerRadius: 8))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.fill.quaternary, in: .rect(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(.fill.tertiary, lineWidth: 0.5)
            )

            Spacer(minLength: 40)
        }
        .padding(.vertical, 2)
    }

    private var errorBubble: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                    Text(message.errorTitle ?? "Error")
                        .font(.caption.weight(.medium))
                }
                .foregroundStyle(.red)

                Text(message.content)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .background(.red.opacity(0.08), in: .rect(cornerRadius: 14))

            Spacer(minLength: 40)
        }
        .padding(.vertical, 2)
    }

    private var toolIcon: String {
        let category = message.toolDisplayMeta?.category ?? ""
        switch category {
        case "mcp": return "server.rack"
        case "source": return "link"
        case "skill": return "sparkles"
        default: return "terminal"
        }
    }

    @ViewBuilder
    private var toolStatusBadge: some View {
        switch message.toolStatus {
        case .executing:
            ProgressView()
                .controlSize(.mini)
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
        case .error:
            Image(systemName: "xmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.red)
        default:
            EmptyView()
        }
    }

    private var tokenSummary: String? {
        nil // Could show token usage if available on message
    }
}

// MARK: - Streaming Bubble

struct StreamingBubble: View {
    let text: String

    var body: some View {
        HStack {
            HStack(spacing: 4) {
                Text(text)
                    .font(.body)

                TypingIndicator()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.fill.quaternary, in: .rect(cornerRadius: 18, style: .continuous))

            Spacer(minLength: 40)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Typing Indicator

struct TypingIndicator: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(.secondary)
                    .frame(width: 5, height: 5)
                    .opacity(dotOpacity(for: index))
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                phase = 1.0
            }
        }
    }

    private func dotOpacity(for index: Int) -> Double {
        let offset = Double(index) * 0.3
        return 0.3 + 0.7 * max(0, sin(.pi * (phase - offset)))
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let text: String

    var body: some View {
        HStack {
            Spacer()
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.mini)
                Text(text)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.fill.tertiary, in: Capsule())
            Spacer()
        }
        .padding(.vertical, 4)
    }
}
