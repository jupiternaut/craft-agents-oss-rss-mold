// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Displays a list of sessions for the current workspace.
struct SessionsListView: View {
    @Environment(AppViewModel.self) private var appViewModel
    @State private var viewModel: SessionsViewModel?
    @State private var selectedSessionId: String?

    var body: some View {
        NavigationStack {
            Group {
                if let vm = viewModel {
                    sessionsList(vm)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Sessions")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        guard let vm = viewModel else { return }
                        Task {
                            if let id = await vm.createSession() {
                                selectedSessionId = id
                            }
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .navigationDestination(item: $selectedSessionId) { sessionId in
                ChatView(
                    sessionId: sessionId,
                    rpcClient: appViewModel.rpcClient,
                    sessionsViewModel: viewModel
                )
            }
        }
        .task {
            let vm = SessionsViewModel(
                rpcClient: appViewModel.rpcClient,
                workspaceId: { [weak appViewModel] in appViewModel?.currentWorkspaceId }
            )
            self.viewModel = vm
            await vm.loadSessions()
        }
    }

    @ViewBuilder
    private func sessionsList(_ vm: SessionsViewModel) -> some View {
        @Bindable var bindableVM = vm

        List {
            if vm.filteredSessions.isEmpty && !vm.isLoading {
                ContentUnavailableView(
                    "No Sessions",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Tap + to start a new conversation")
                )
                .listRowSeparator(.hidden)
            } else {
                ForEach(vm.filteredSessions) { session in
                    SessionRow(session: session)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedSessionId = session.id
                        }
                }
                .onDelete { indexSet in
                    let sessions = vm.filteredSessions
                    for index in indexSet {
                        let session = sessions[index]
                        Task { await vm.deleteSession(session.id) }
                    }
                }
            }
        }
        .listStyle(.plain)
        .searchable(text: $bindableVM.searchQuery, prompt: "Search sessions")
        .refreshable {
            await vm.loadSessions()
        }
        .overlay {
            if vm.isLoading && vm.sessions.isEmpty {
                ProgressView()
            }
        }
    }
}

// MARK: - Session Row

struct SessionRow: View {
    let session: Session

    var body: some View {
        HStack(spacing: 12) {
            // Status indicator
            Circle()
                .fill(session.isProcessing ? Color.blue : Color.clear)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(session.name ?? "New Session")
                        .font(.body.weight(.medium))
                        .lineLimit(1)

                    Spacer()

                    if session.isFlagged {
                        Image(systemName: "flag.fill")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }

                    if let date = session.lastMessageAt {
                        Text(formatRelativeDate(date))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                if let preview = session.preview, !preview.isEmpty {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if !session.labels.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(session.labels.prefix(3), id: \.self) { label in
                            Text(label)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.fill.tertiary, in: Capsule())
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func formatRelativeDate(_ timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
