import SwiftUI
@main
struct RDesignApp: App { var body: some Scene { WindowGroup { WorkbenchShell() } } }
struct WorkbenchShell: View {
    @AppStorage("rdesign.bridgeAddress") private var address = ""
    @State private var connectedURL: URL?
    @State private var connectionRevision = 0
    @State private var status = "输入电脑或网关的 HTTPS 地址，然后使用电脑生成的配对码。"
    @State private var drawingEnabled = false
    @State private var saveCounter = 0
    @State private var clearCounter = 0
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("R-Design").font(.headline)
                TextField("https://your-bridge.example", text: $address).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
                Button("连接") { connect() }
                Toggle("Pencil", isOn: $drawingEnabled).fixedSize()
                Button("交给批注") { saveCounter += 1 }.disabled(!drawingEnabled)
                Button("清除筆迹") { clearCounter += 1 }.disabled(!drawingEnabled)
            }.padding(12)
            Text(status).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.bottom, 8)
            if let url = connectedURL { NativeWorkbench(url: url, connectionRevision: connectionRevision, drawingEnabled: drawingEnabled, saveCounter: saveCounter, clearCounter: clearCounter, status: $status) }
            else {
                Spacer()
                Image(systemName: "pencil.tip.crop.circle").font(.system(size: 72)).foregroundStyle(.orange)
                Text("连接同一工作区").font(.title2).padding(.top)
                Text("依赖安装、构建和 AI 执行由桌面 Bridge 完成。\n进入批注并冻结画面后，Pencil 即时绘制并缓存到本机。").multilineTextAlignment(.center).foregroundStyle(.secondary).padding()
                Spacer()
            }
        }.onAppear { if !address.isEmpty { connect() } }
    }
    private func connect() {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)), let host = url.host,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.scheme == "https" || (url.scheme == "http" && (host == "localhost" || host == "127.0.0.1")) else {
            status = "请输入 HTTPS Bridge 地址。明文 HTTP 仅允许开发本机。"; return
        }
        connectionRevision += 1; connectedURL = url; status = "连接后在工作台输入一次性配对码。"
    }
}
