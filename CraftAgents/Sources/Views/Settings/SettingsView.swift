// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Settings screen with server info, workspace selector, LLM connections, and automations.
struct SettingsView: View {
    @Environment(AppViewModel.self) private var appViewModel
    @State private var viewModel: SettingsViewModel?

    var body: some View {
        NavigationStack {
            List {
                // Connection section
                Section("Connection") {
                    LabeledContent("Server", value: appViewModel.serverURL)
                    LabeledContent("Status") {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(appViewModel.isConnected ? .green : .red)
                                .frame(width: 8, height: 8)
                            Text(appViewModel.isConnected ? "Connected" : "Disconnected")
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let version = appViewModel.serverStatus?.version {
                        LabeledContent("Version", value: version)
                    }

                    Button("Disconnect", role: .destructive) {
                        appViewModel.disconnect()
                    }
                }

                // Workspace section
                if !appViewModel.workspaces.isEmpty {
                    Section("Workspace") {
                        ForEach(appViewModel.workspaces) { workspace in
                            Button {
                                Task { await appViewModel.selectWorkspace(workspace.id) }
                            } label: {
                                HStack {
                                    Text(workspace.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if workspace.id == appViewModel.currentWorkspaceId {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.blue)
                                    }
                                }
                            }
                        }
                    }
                }

                // LLM Connections
                if let vm = viewModel, !vm.llmConnections.isEmpty {
                    Section("LLM Connections") {
                        ForEach(vm.llmConnections) { connection in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(connection.name)
                                        .font(.body.weight(.medium))
                                    Spacer()
                                    if connection.isDefault == true {
                                        Text("Default")
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.blue.opacity(0.1), in: Capsule())
                                            .foregroundStyle(.blue)
                                    }
                                }
                                if let provider = connection.provider {
                                    Text(provider)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if let models = connection.models, !models.isEmpty {
                                    Text("\(models.count) models available")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }

                // Automations
                if let vm = viewModel, !vm.automations.isEmpty {
                    Section("Automations") {
                        ForEach(vm.automations) { automation in
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(automation.name)
                                        .font(.body.weight(.medium))
                                    if let desc = automation.description, !desc.isEmpty {
                                        Text(desc)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                Circle()
                                    .fill(automation.isEnabled ? .green : .gray.opacity(0.3))
                                    .frame(width: 8, height: 8)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }

                // About
                Section("About") {
                    LabeledContent("App", value: "Craft Agents iOS")
                    LabeledContent("Protocol", value: "1.0")
                    Link("GitHub Repository", destination: URL(string: "https://github.com/lukilabs/craft-agents-oss")!)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
        }
        .task {
            let vm = SettingsViewModel(
                rpcClient: appViewModel.rpcClient,
                workspaceId: { [weak appViewModel] in appViewModel?.currentWorkspaceId }
            )
            self.viewModel = vm
            await vm.loadSettings()
        }
    }
}
