// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Displays the list of configured skills (custom instructions).
struct SkillsListView: View {
    @Environment(AppViewModel.self) private var appViewModel
    @State private var viewModel: SkillsViewModel?

    var body: some View {
        NavigationStack {
            Group {
                if let vm = viewModel {
                    skillsList(vm)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Skills")
            .navigationBarTitleDisplayMode(.large)
        }
        .task {
            let vm = SkillsViewModel(
                rpcClient: appViewModel.rpcClient,
                workspaceId: { [weak appViewModel] in appViewModel?.currentWorkspaceId }
            )
            self.viewModel = vm
            await vm.loadSkills()
        }
    }

    @ViewBuilder
    private func skillsList(_ vm: SkillsViewModel) -> some View {
        List {
            if vm.skills.isEmpty && !vm.isLoading {
                ContentUnavailableView(
                    "No Skills",
                    systemImage: "sparkles",
                    description: Text("Ask the agent to create a skill")
                )
                .listRowSeparator(.hidden)
            } else {
                ForEach(vm.skills) { skill in
                    SkillRow(skill: skill)
                }
            }
        }
        .listStyle(.plain)
        .refreshable {
            await vm.loadSkills()
        }
        .overlay {
            if vm.isLoading && vm.skills.isEmpty {
                ProgressView()
            }
        }
    }
}

// MARK: - Skill Row

struct SkillRow: View {
    let skill: Skill

    var body: some View {
        HStack(spacing: 12) {
            // Icon
            ZStack {
                Circle()
                    .fill(.fill.tertiary)
                    .frame(width: 40, height: 40)

                if let icon = skill.icon, !icon.isEmpty {
                    Text(icon)
                        .font(.title3)
                } else {
                    Image(systemName: "sparkles")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(skill.name)
                    .font(.body.weight(.medium))

                if let desc = skill.description, !desc.isEmpty {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                if let globs = skill.globs, !globs.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(globs.prefix(3), id: \.self) { glob in
                            Text(glob)
                                .font(.caption2.monospaced())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.fill.tertiary, in: Capsule())
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}
