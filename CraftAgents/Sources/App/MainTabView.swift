// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Main tab bar interface after successful connection.
struct MainTabView: View {
    @Environment(AppViewModel.self) private var appViewModel
    @State private var selectedTab: Tab = .sessions

    enum Tab: Hashable {
        case sessions
        case sources
        case skills
        case settings
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            SessionsListView()
                .tabItem {
                    Label("Sessions", systemImage: "bubble.left.and.bubble.right")
                }
                .tag(Tab.sessions)

            SourcesListView()
                .tabItem {
                    Label("Sources", systemImage: "link")
                }
                .tag(Tab.sources)

            SkillsListView()
                .tabItem {
                    Label("Skills", systemImage: "sparkles")
                }
                .tag(Tab.skills)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
                .tag(Tab.settings)
        }
        .tint(.primary)
    }
}
