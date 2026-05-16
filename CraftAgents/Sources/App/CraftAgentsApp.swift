// SPDX-License-Identifier: Apache-2.0

import SwiftUI

@main
struct CraftAgentsApp: App {
    @State private var appViewModel = AppViewModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appViewModel)
        }
    }
}
