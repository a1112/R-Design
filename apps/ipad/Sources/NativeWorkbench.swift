import SwiftUI
import WebKit
import PencilKit
import CryptoKit
struct NativeWorkbench: UIViewRepresentable {
    let url: URL
    let connectionRevision: Int
    let drawingEnabled: Bool
    let saveCounter: Int
    let clearCounter: Int
    @Binding var status: String
    func makeUIView(context: Context) -> NativeWorkbenchView {
        let view = NativeWorkbenchView(url: url)
        view.onStatus = { message in DispatchQueue.main.async { status = message } }
        return view
    }
    func updateUIView(_ view: NativeWorkbenchView, context: Context) {
        view.navigateIfNeeded(url, connectionRevision: connectionRevision); view.drawingEnabled = drawingEnabled
        if view.saveCounter != saveCounter { view.saveCounter = saveCounter; view.transferDrawing() }
        if view.clearCounter != clearCounter { view.clearCounter = clearCounter; view.clearDrawing() }
    }
}
private struct NativeTarget: Decodable {
    let x: Double; let y: Double; let w: Double; let h: Double
    let frameWidth: Double; let frameHeight: Double; let frameId: String; let mode: String; let viewportWidth: Double?
}
private struct DrawingDraft: Codable { let frameId: String; let drawing: Data; let width: Double; let height: Double }
final class NativeWorkbenchView: UIView, WKNavigationDelegate, PKCanvasViewDelegate {
    private let webView: WKWebView
    private let canvas = PKCanvasView()
    private let toolPicker = PKToolPicker()
    private var currentURL: URL
    private var connectionRevision = -1
    private var target: NativeTarget?
    private var currentFrameId: String?
    private var polling = false
    private var restoring = false
    private var timer: Timer?
    var saveCounter = 0
    var clearCounter = 0
    var onStatus: ((String) -> Void)?
    var drawingEnabled = false { didSet { updateOverlay() } }
    init(url: URL) {
        currentURL = url
        let config = WKWebViewConfiguration(); config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(frame: .zero)
        webView.navigationDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        addSubview(webView)
        canvas.backgroundColor = .clear; canvas.isOpaque = false
        canvas.drawingPolicy = .pencilOnly; canvas.isScrollEnabled = false; canvas.delegate = self
        canvas.tool = PKInkingTool(.pen, color: .systemOrange, width: 3)
        addSubview(canvas); canvas.isHidden = true
        toolPicker.addObserver(canvas)
        webView.load(URLRequest(url: url))
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.pollTarget() }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    deinit { timer?.invalidate() }
    override func layoutSubviews() { super.layoutSubviews(); webView.frame = bounds; updateOverlay() }
    func navigateIfNeeded(_ url: URL, connectionRevision: Int) {
        guard url != currentURL || self.connectionRevision != connectionRevision else { return }
        self.connectionRevision = connectionRevision; persistDraft(); target = nil; currentFrameId = nil; currentURL = url; canvas.drawing = PKDrawing(); webView.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == true && (url.scheme != currentURL.scheme || url.host != currentURL.host || url.port != currentURL.port) {
            onStatus?("已阻止离开授权工作台。请在地址栏连接新 Bridge。"); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        onStatus?("连接失败：\(error.localizedDescription)。本机笔迹缓存保留。"); target = nil; updateOverlay()
    }
    private func pollTarget() {
        guard !polling, window != nil, webView.url?.host == currentURL.host else { return }
        polling = true
        webView.evaluateJavaScript("JSON.stringify(window.__RDESIGN_WORKBENCH__?.nativeTarget?.() ?? null)") { [weak self] value, error in
            guard let self else { return }; self.polling = false
            guard error == nil, let string = value as? String, let data = string.data(using: .utf8), let next = try? JSONDecoder().decode(NativeTarget.self, from: data), next.w > 0, next.h > 0, next.frameWidth > 0, next.frameHeight > 0 else {
                self.target = nil; self.updateOverlay(); return
            }
            if self.currentFrameId != next.frameId {
                self.persistDraft(); self.currentFrameId = next.frameId; self.target = next; self.restoreDraft()
            } else if let old = self.target, abs(old.w - next.w) > 0.5 || abs(old.h - next.h) > 0.5 {
                self.persistDraft(); self.restoring = true
                self.canvas.drawing = self.canvas.drawing.transformed(using: CGAffineTransform(scaleX: next.w / old.w, y: next.h / old.h)); self.restoring = false
            }
            self.target = next; self.updateOverlay()
        }
    }
    private func updateOverlay() {
        guard drawingEnabled, let target, target.mode == "annotate" else { canvas.isHidden = true; toolPicker.setVisible(false, forFirstResponder: canvas); return }
        let scale = Double(webView.bounds.width) / max(1, target.viewportWidth ?? Double(webView.bounds.width))
        canvas.frame = CGRect(x: target.x * scale, y: target.y * scale, width: target.w * scale, height: target.h * scale)
        canvas.contentSize = canvas.bounds.size; canvas.isHidden = false
        toolPicker.setVisible(true, forFirstResponder: canvas); canvas.becomeFirstResponder()
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { if !restoring { persistDraft() } }
    private func draftURL(_ frameId: String) -> URL {
        let digest = SHA256.hash(data: Data((currentURL.absoluteString + ":" + frameId).utf8)).map { String(format: "%02x", $0) }.joined()
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PencilDrafts", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(digest + ".json")
    }
    private func persistDraft() {
        guard target != nil, let frameId = currentFrameId, canvas.bounds.width > 0, canvas.bounds.height > 0 else { return }
        let draft = DrawingDraft(frameId: frameId, drawing: canvas.drawing.dataRepresentation(), width: Double(canvas.bounds.width), height: Double(canvas.bounds.height))
        do { try JSONEncoder().encode(draft).write(to: draftURL(frameId), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
        catch { onStatus?("本机缓存失败：\(error.localizedDescription)") }
    }
    private func restoreDraft() {
        restoring = true; defer { restoring = false }; canvas.drawing = PKDrawing()
        guard let target, let data = try? Data(contentsOf: draftURL(target.frameId)), let draft = try? JSONDecoder().decode(DrawingDraft.self, from: data), draft.frameId == target.frameId, let drawing = try? PKDrawing(data: draft.drawing) else { return }
        let scale = Double(webView.bounds.width) / max(1, target.viewportWidth ?? Double(webView.bounds.width))
        canvas.drawing = drawing.transformed(using: CGAffineTransform(scaleX: target.w * scale / max(1, draft.width), y: target.h * scale / max(1, draft.height)))
        onStatus?("已恢复此冻结帧的本机笔迹草稿。")
    }
    func clearDrawing() { canvas.drawing = PKDrawing(); persistDraft(); onStatus?("已清除当前帧的本机笔迹；共享批注保留。") }
    func transferDrawing() {
        guard let target, target.mode == "annotate", !canvas.drawing.strokes.isEmpty, canvas.bounds.width > 0, canvas.bounds.height > 0 else { onStatus?("先进入批注模式并选择冻结画面，再绘制笔迹。"); return }
        let sx = target.frameWidth / Double(canvas.bounds.width), sy = target.frameHeight / Double(canvas.bounds.height)
        let strokes: [[String: Any]] = canvas.drawing.strokes.enumerated().flatMap { index, stroke in
            stroke.maskedPathRanges.enumerated().map { segment, range in
            let points: [[String: Any]] = stroke.path.interpolatedPoints(in: range, by: .distance(2)).map { point in
                let position = point.location.applying(stroke.transform)
                return ["x": Double(position.x) * sx, "y": Double(position.y) * sy, "pressure": max(0, min(1, Double(point.force))), "time": point.timeOffset * 1000]
            }
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0; stroke.ink.color.getRed(&r, green: &g, blue: &b, alpha: &a)
            return ["id": "pencil-\(target.frameId)-\(index)-\(segment)", "points": points, "color": String(format: "#%02x%02x%02x", Int(r*255), Int(g*255), Int(b*255)), "width": max(0.1, min(100, Double(stroke.path.first?.size.width ?? 3) * (sx + sy) / 2))]
            }
        }
        guard strokes.count <= 200, strokes.allSatisfy({ ($0["points"] as? [[String: Any]])?.count ?? 0 <= 20000 }) else { onStatus?("笔迹过多，请拆分批注；原始笔迹仍缓存。"); return }
        let payload: [String: Any] = ["nativeData": canvas.drawing.dataRepresentation().base64EncodedString(), "strokes": strokes, "frameId": target.frameId]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        let frameJSON = (try? JSONSerialization.data(withJSONObject: [target.frameId])).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        let script = "(() => { const api = window.__RDESIGN_WORKBENCH__; if (!api?.addNativeDrawing || api.nativeTarget?.()?.frameId !== \(frameJSON)[0]) return false; return api.addNativeDrawing(\(json)); })()"
        webView.evaluateJavaScript(script) { [weak self] result, error in
            if let error { self?.onStatus?("草稿传递失败：\(error.localizedDescription)。本机缓存保留。") }
            else if (result as? Bool) == false || ((result as? [String: Any])?["accepted"] as? Bool) == false { self?.onStatus?("冻结帧已变化，刷新后再传递笔迹。") }
            else { self?.onStatus?("笔迹已交给工作台批注草稿。请在工作台保存批注；原始数据仍缓存到本机。") }
        }
    }
}
