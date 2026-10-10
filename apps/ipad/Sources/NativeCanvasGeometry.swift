import Foundation

struct NativeViewport: Decodable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    var rect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
}

struct NativeTarget: Decodable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    let frameWidth: Double
    let frameHeight: Double
    let frameId: String
    let mode: String
    let viewportWidth: Double?
    let viewport: NativeViewport?
    let projectId: String?

    var isValid: Bool {
        [x, y, w, h, frameWidth, frameHeight].allSatisfy(\.isFinite)
            && w > 0 && h > 0 && frameWidth > 0 && frameHeight > 0
            && (viewportWidth == nil || (viewportWidth!.isFinite && viewportWidth! > 0))
            && (viewport == nil || [viewport!.x, viewport!.y, viewport!.w, viewport!.h].allSatisfy(\.isFinite))
    }
}

/// CSS geometry is converted to WK points before clipping. The canvas retains its
/// entire transformed source frame, including the portion outside the viewport.
struct NativeCanvasLayout {
    let clippingFrame: CGRect
    let canvasFrame: CGRect
    let sourceSize: CGSize
    let visible: Bool

    init(target: NativeTarget, webBounds: CGRect) {
        let scale = webBounds.width / max(1, CGFloat(target.viewportWidth ?? Double(webBounds.width)))
        let fullFrame = CGRect(x: CGFloat(target.x) * scale, y: CGFloat(target.y) * scale,
                               width: CGFloat(target.w) * scale, height: CGFloat(target.h) * scale)
        let rawViewport: CGRect
        if let viewport = target.viewport {
            rawViewport = CGRect(x: CGFloat(viewport.x) * scale, y: CGFloat(viewport.y) * scale,
                                 width: max(0, CGFloat(viewport.w)) * scale,
                                 height: max(0, CGFloat(viewport.h)) * scale)
        } else {
            rawViewport = fullFrame
        }
        let clipped = rawViewport.intersection(webBounds)
        clippingFrame = clipped.isNull ? .zero : clipped
        canvasFrame = CGRect(x: fullFrame.minX - clippingFrame.minX,
                             y: fullFrame.minY - clippingFrame.minY,
                             width: fullFrame.width, height: fullFrame.height)
        sourceSize = CGSize(width: target.frameWidth, height: target.frameHeight)
        visible = !clippingFrame.isEmpty && !fullFrame.intersection(clippingFrame).isEmpty
    }

    func resizeTransform(from previous: CGSize) -> CGAffineTransform? {
        guard previous.width > 0, previous.height > 0,
              abs(previous.width - canvasFrame.width) > 0.01 || abs(previous.height - canvasFrame.height) > 0.01 else { return nil }
        return CGAffineTransform(scaleX: canvasFrame.width / previous.width,
                                 y: canvasFrame.height / previous.height)
    }

    func sourceWidth(_ width: CGFloat, strokeTransform: CGAffineTransform) -> CGFloat {
        let sx = sourceSize.width / canvasFrame.width
        let sy = sourceSize.height / canvasFrame.height
        let xAxis = hypot(strokeTransform.a * sx, strokeTransform.b * sy)
        let yAxis = hypot(strokeTransform.c * sx, strokeTransform.d * sy)
        return width * (xAxis + yAxis) / 2
    }

    func sourcePoint(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x * sourceSize.width / canvasFrame.width,
                y: point.y * sourceSize.height / canvasFrame.height)
    }
}
