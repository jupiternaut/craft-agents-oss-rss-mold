// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// Connection setup screen — server URL, token, and connect button.
struct ConnectView: View {
    @Environment(AppViewModel.self) private var appViewModel
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case serverURL
        case authToken
    }

    var body: some View {
        @Bindable var vm = appViewModel

        NavigationStack {
            ScrollView {
                VStack(spacing: 32) {
                    // Logo / branding
                    VStack(spacing: 12) {
                        Image(systemName: "cpu")
                            .font(.system(size: 48, weight: .thin))
                            .foregroundStyle(.primary)

                        Text("Craft Agents")
                            .font(.largeTitle.weight(.semibold))

                        Text("Connect to your server")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 40)

                    // Form fields
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Server URL")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)

                            TextField("ws://192.168.1.100:9100", text: $vm.serverURL)
                                .textFieldStyle(.plain)
                                .keyboardType(.URL)
                                .textContentType(.URL)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(.fill.tertiary, in: .rect(cornerRadius: 10))
                                .focused($focusedField, equals: .serverURL)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("Auth Token")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)

                            SecureField("Optional", text: $vm.authToken)
                                .textFieldStyle(.plain)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(.fill.tertiary, in: .rect(cornerRadius: 10))
                                .focused($focusedField, equals: .authToken)
                        }
                    }
                    .padding(.horizontal)

                    // Error message
                    if let error = appViewModel.errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    // Connect button
                    Button {
                        focusedField = nil
                        Task { await appViewModel.connect() }
                    } label: {
                        Group {
                            if appViewModel.isConnecting {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Text("Connect")
                                    .fontWeight(.semibold)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.primary)
                    .clipShape(.rect(cornerRadius: 12))
                    .disabled(appViewModel.isConnecting || appViewModel.serverURL.isEmpty)
                    .padding(.horizontal)

                    Spacer()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
