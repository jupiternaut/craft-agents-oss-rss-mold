// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Root navigation view that shows either the connection setup or the main tab interface.
struct RootView: View {
    @Environment(AppViewModel.self) private var appViewModel

    var body: some View {
        Group {
            if appViewModel.isConnected {
                MainTabView()
            } else {
                ConnectView()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: appViewModel.isConnected)
    }
}
