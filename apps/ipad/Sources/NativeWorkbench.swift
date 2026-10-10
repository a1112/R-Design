import SwiftUI
import WebKit
import PencilKit
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
/// Empty clipped areas and finger gestures continue to reach the Web camera.
private final class PencilClipView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard !isHidden, let touches = event?.allTouches,
              touches.contains(where: { $0.type == .pencil }) else { return nil }
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}

final class NativeWorkbenchView: UIView, WKNavigationDelegate, PKCanvasViewDelegate {
    private let webView: WKWebView
    private let canvas = PKCanvasView()
    private let pencilClip = PencilClipView()
    private let toolPicker = PKToolPicker()
    private var currentURL: URL
    private var connectionRevision = -1
    private var target: NativeTarget?
    private var currentFrameId: String?
    private var currentProjectId: String?
    private var polling = false
    private var lastTargetPoll: TimeInterval = 0
    private var restoring = false
    private var currentDraftSaved = false
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
        pencilClip.clipsToBounds = true
        pencilClip.backgroundColor = .clear
        addSubview(pencilClip)
        pencilClip.addSubview(canvas)
        pencilClip.isHidden = true
        toolPicker.addObserver(canvas)
        webView.load(URLRequest(url: url))
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.pollTarget() }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    deinit { timer?.invalidate() }
    override func layoutSubviews() { super.layoutSubviews(); webView.frame = bounds; updateOverlay() }
    func navigateIfNeeded(_ url: URL, connectionRevision: Int) {
        guard url != currentURL || self.connectionRevision != connectionRevision else { return }
        self.connectionRevision = connectionRevision; persistDraft(); target = nil; currentFrameId = nil; currentProjectId = nil; currentDraftSaved = false; currentURL = url; canvas.drawing = PKDrawing(); webView.load(URLRequest(url: url))
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
        guard !polling, window != nil, webView.bounds.width > 0, webView.bounds.height > 0, webView.url?.host == currentURL.host else { return }
        let now = Date.timeIntervalSinceReferenceDate
        guard drawingEnabled || now - lastTargetPoll >= 0.25 else { return }
        lastTargetPoll = now
        polling = true
        webView.evaluateJavaScript("JSON.stringify(window.__RDESIGN_WORKBENCH__?.nativeTarget?.() ?? null)") { [weak self] value, error in
            guard let self else { return }; self.polling = false
            guard error == nil, let string = value as? String, let data = string.data(using: .utf8), let next = try? JSONDecoder().decode(NativeTarget.self, from: data), next.isValid else {
                if self.target != nil { self.persistDraft() }
                self.target = nil; self.updateOverlay(); return
            }
            if self.currentFrameId != next.frameId || self.currentProjectId != next.projectId {
                self.persistDraft()
                self.currentFrameId = next.frameId
                self.currentProjectId = next.projectId
                self.target = next
                self.restoreDraft()
                // Restored data already has the new physical canvas dimensions.
                self.applyLayout(NativeCanvasLayout(target: next, webBounds: self.webView.bounds), rescaleDrawing: false)
            } else {
                self.target = next
                self.applyLayout(NativeCanvasLayout(target: next, webBounds: self.webView.bounds), rescaleDrawing: true)
            }
            self.updateOverlayVisibility()
        }
    }
    private func updateOverlay() {
        guard let target, target.isValid, webView.bounds.width > 0 else {
            pencilClip.isHidden = true
            toolPicker.setVisible(false, forFirstResponder: canvas)
            return
        }
        applyLayout(NativeCanvasLayout(target: target, webBounds: webView.bounds), rescaleDrawing: true)
        updateOverlayVisibility()
    }
    private func applyLayout(_ layout: NativeCanvasLayout, rescaleDrawing: Bool) {
        let transform = rescaleDrawing ? layout.resizeTransform(from: canvas.bounds.size) : nil
        if let transform {
            persistDraft()
            restoring = true
            canvas.drawing = canvas.drawing.transformed(using: transform)
        }
        pencilClip.frame = layout.clippingFrame
        canvas.frame = layout.canvasFrame
        canvas.contentSize = canvas.bounds.size
        canvas.contentOffset = .zero
        if transform != nil {
            restoring = false
            persistDraft()
        }
    }
    private func updateOverlayVisibility() {
        let visible = drawingEnabled && target?.mode == "annotate"
            && target.map { NativeCanvasLayout(target: $0, webBounds: webView.bounds).visible } == true
        let wasVisible = !pencilClip.isHidden
        pencilClip.isHidden = !visible
        toolPicker.setVisible(visible, forFirstResponder: canvas)
        // Repeated camera updates must not steal Web text/keyboard focus.
        if visible && !wasVisible { canvas.becomeFirstResponder() }
        if !visible && wasVisible { canvas.resignFirstResponder() }
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { if !restoring { persistDraft() } }
    private func draftURL(_ identity: NativeDraftIdentity) -> URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PencilDrafts", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(identity.filename(bridgeURL: currentURL))
    }
    private func persistDraft() {
        guard let frameId = currentFrameId, canvas.bounds.width > 0, canvas.bounds.height > 0,
              currentDraftSaved || !canvas.drawing.strokes.isEmpty else { return }
        let identity = NativeDraftIdentity(projectId: currentProjectId, frameId: frameId)
        let draft = NativeDrawingDraft(frameId: frameId, projectId: currentProjectId, drawing: canvas.drawing.dataRepresentation(), width: Double(canvas.bounds.width), height: Double(canvas.bounds.height))
        do {
            try JSONEncoder().encode(draft).write(to: draftURL(identity), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            currentDraftSaved = true
        }
        catch { onStatus?("本机缓存失败：\(error.localizedDescription)") }
    }
    private func restoreDraft() {
        restoring = true; defer { restoring = false }; currentDraftSaved = false; canvas.drawing = PKDrawing()
        guard let target else { return }
        let identity = NativeDraftIdentity(projectId: target.projectId, frameId: target.frameId)
        guard let data = try? Data(contentsOf: draftURL(identity)),
              let draft = try? JSONDecoder().decode(NativeDrawingDraft.self, from: data), draft.matches(identity),
              let drawing = try? PKDrawing(data: draft.drawing) else { return }
        currentDraftSaved = true
        let layout = NativeCanvasLayout(target: target, webBounds: webView.bounds)
        canvas.drawing = drawing.transformed(using: CGAffineTransform(
            scaleX: Double(layout.canvasFrame.width) / max(1, draft.width),
            y: Double(layout.canvasFrame.height) / max(1, draft.height)))
        onStatus?("已恢复此冻结帧的本机笔迹草稿。")
    }
    func clearDrawing() { canvas.drawing = PKDrawing(); persistDraft(); onStatus?("已清除当前帧的本机笔迹；共享批注保留。") }
    func transferDrawing() {
        guard let target, target.mode == "annotate", !canvas.drawing.strokes.isEmpty, canvas.bounds.width > 0, canvas.bounds.height > 0 else { onStatus?("先进入批注模式并选择冻结画面，再绘制笔迹。"); return }
        let layout = NativeCanvasLayout(target: target, webBounds: webView.bounds)
        let sx = target.frameWidth / Double(canvas.bounds.width), sy = target.frameHeight / Double(canvas.bounds.height)
        let strokes: [[String: Any]] = canvas.drawing.strokes.enumerated().flatMap { index, stroke in
            stroke.maskedPathRanges.enumerated().map { segment, range in
            let points: [[String: Any]] = stroke.path.interpolatedPoints(in: range, by: .distance(2)).map { point in
                let position = point.location.applying(stroke.transform)
                return ["x": Double(position.x) * sx, "y": Double(position.y) * sy, "pressure": max(0, min(1, Double(point.force))), "time": point.timeOffset * 1000]
            }
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0; stroke.ink.color.getRed(&r, green: &g, blue: &b, alpha: &a)
            return ["id": "pencil-\(target.frameId)-\(index)-\(segment)", "points": points, "color": String(format: "#%02x%02x%02x", Int(r*255), Int(g*255), Int(b*255)), "width": max(0.1, min(100, Double(layout.sourceWidth(stroke.path.first?.size.width ?? 3, strokeTransform: stroke.transform))))]
            }
        }
        guard strokes.count <= 200, strokes.allSatisfy({ ($0["points"] as? [[String: Any]])?.count ?? 0 <= 20000 }) else { onStatus?("笔迹过多，请拆分批注；原始笔迹仍缓存。"); return }
        var payload: [String: Any] = ["nativeData": canvas.drawing.dataRepresentation().base64EncodedString(), "strokes": strokes, "frameId": target.frameId]
        if let projectId = target.projectId { payload["projectId"] = projectId }
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        let script = "(() => { const api = window.__RDESIGN_WORKBENCH__; const detail = \(json); const current = api?.nativeTarget?.(); if (!api?.addNativeDrawing || !current || current.frameId !== detail.frameId || (detail.projectId !== undefined && current.projectId !== detail.projectId)) return false; return api.addNativeDrawing(detail); })()"
        webView.evaluateJavaScript(script) { [weak self] result, error in
            if let error { self?.onStatus?("草稿传递失败：\(error.localizedDescription)。本机缓存保留。") }
            else if (result as? Bool) == false || ((result as? [String: Any])?["accepted"] as? Bool) == false { self?.onStatus?("冻结帧已变化，刷新后再传递笔迹。") }
            else { self?.onStatus?("笔迹已交给工作台批注草稿。请在工作台保存批注；原始数据仍缓存到本机。") }
        }
    }
}
