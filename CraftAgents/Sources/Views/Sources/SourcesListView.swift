// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Displays the list of connected data sources (MCP servers, APIs, local paths).
struct SourcesListView: View {
    @Environment(AppViewModel.self) private var appViewModel
    @State private var viewModel: SourcesViewModel?

    var body: some View {
        NavigationStack {
            Group {
                if let vm = viewModel {
                    sourcesList(vm)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Sources")
            .navigationBarTitleDisplayMode(.large)
        }
        .task {
            let vm = SourcesViewModel(
                rpcClient: appViewModel.rpcClient,
                workspaceId: { [weak appViewModel] in appViewModel?.currentWorkspaceId }
            )
            self.viewModel = vm
            await vm.loadSources()
        }
    }

    @ViewBuilder
    private func sourcesList(_ vm: SourcesViewModel) -> some View {
        List {
            if vm.sources.isEmpty && !vm.isLoading {
                ContentUnavailableView(
                    "No Sources",
                    systemImage: "link",
                    description: Text("Ask the agent to connect to a service")
                )
                .listRowSeparator(.hidden)
            } else {
                ForEach(vm.sources) { source in
                    SourceRow(source: source)
                }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await vm.loadSources()
        }
        .overlay {
            if vm.isLoading && vm.sources.isEmpty {
                ProgressView()
            }
        }
    }
}

// MARK: - Source Row

struct SourceRow: View {
    let source: Source

    var body: some View {
        HStack(spacing: 12) {
            // Icon
            ZStack {
                Circle()
                    .fill(.fill.tertiary)
                    .frame(width: 40, height: 40)

                Image(systemName: sourceIcon)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(source.name)
                        .font(.body.weight(.medium))

                    Spacer()

                    if source.isConnected == true {
                        Circle()
                            .fill(.green)
                            .frame(width: 7, height: 7)
                    }
                }

                if let desc = source.description, !desc.isEmpty {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    if let type = source.type {
                        Text(type.rawValue.uppercased())
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                    }

                    if let count = source.toolCount, count > 0 {
                        Text("\(count) tools")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var sourceIcon: String {
        switch source.type {
        case .mcp: return "server.rack"
        case .api: return "arrow.left.arrow.right"
        case .local: return "folder"
        case .unknown: return "questionmark.circle"
        case .none: return "link"
        }
    }
}
