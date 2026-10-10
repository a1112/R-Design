import XCTest
import PencilKit
@testable import RDesign

final class NativeCanvasGeometryTests: XCTestCase {
    private func target(x: Double = 20, y: Double = 40, w: Double = 1000, h: Double = 800,
                        sourceW: Double = 1200, sourceH: Double = 960,
                        viewportWidth: Double = 1200, viewport: NativeViewport? = NativeViewport(x: 200, y: 100, w: 600, h: 500)) -> NativeTarget {
        NativeTarget(x: x, y: y, w: w, h: h, frameWidth: sourceW, frameHeight: sourceH,
                     frameId: "frozen-frame", mode: "annotate", viewportWidth: viewportWidth, viewport: viewport, projectId: nil)
    }
    func testViewportClipsChromeWithoutCroppingSourceCanvas() {
        let layout = NativeCanvasLayout(target: target(), webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        XCTAssertEqual(layout.clippingFrame, CGRect(x: 200, y: 100, width: 600, height: 500))
        XCTAssertEqual(layout.canvasFrame, CGRect(x: -180, y: -60, width: 1000, height: 800))
        XCTAssertEqual(layout.sourcePoint(CGPoint(x: 500, y: 400)), CGPoint(x: 600, y: 480))
        XCTAssertTrue(layout.visible)
    }
    func testOffscreenFrameKeepsFullDimensionsAndHidesInteraction() {
        let layout = NativeCanvasLayout(target: target(x: 2000), webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        XCTAssertFalse(layout.visible)
        XCTAssertEqual(layout.canvasFrame.size, CGSize(width: 1000, height: 800))
        XCTAssertEqual(layout.clippingFrame, CGRect(x: 200, y: 100, width: 600, height: 500))
    }
    func testPhysicalResizePreservesSourcePointAcrossWKViewportScaleChange() {
        let before = NativeCanvasLayout(target: target(w: 500, h: 400, viewportWidth: 1200), webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        let after = NativeCanvasLayout(target: target(w: 2000, h: 1600, viewportWidth: 2400), webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        let original = CGPoint(x: 100, y: 80)
        let transform = try! XCTUnwrap(after.resizeTransform(from: before.canvasFrame.size))
        XCTAssertEqual(after.sourcePoint(original.applying(transform)), before.sourcePoint(original))
        XCTAssertEqual(after.canvasFrame.size, CGSize(width: 1000, height: 800))
    }
    func testPanKeepsDrawingCoordinatesAndLegacyTargetStillDecodes() throws {
        let panned = NativeCanvasLayout(target: target(x: -180, y: 60), webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        XCTAssertNil(panned.resizeTransform(from: CGSize(width: 1000, height: 800)))
        let json = #"{"x":40,"y":60,"w":800,"h":600,"frameWidth":1600,"frameHeight":1200,"frameId":"legacy","mode":"annotate","viewportWidth":1200}"#
        let legacy = try JSONDecoder().decode(NativeTarget.self, from: Data(json.utf8))
        let layout = NativeCanvasLayout(target: legacy, webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        XCTAssertNil(legacy.viewport)
        XCTAssertEqual(layout.clippingFrame, CGRect(x: 40, y: 60, width: 800, height: 600))
        XCTAssertEqual(layout.canvasFrame.origin, .zero)
    }
    func testNativeDrawingCacheRoundTripAndCameraResizePreserveSourceCoordinates() throws {
        let point = PKStrokePoint(location: CGPoint(x: 100, y: 80), timeOffset: 0,
                                  size: CGSize(width: 3, height: 3), opacity: 1,
                                  force: 0.5, azimuth: 0, altitude: .pi / 2)
        let path = PKStrokePath(controlPoints: [point], creationDate: Date())
        let stroke = PKStroke(ink: PKInk(.pen, color: .orange), path: path)
        let original = PKDrawing(strokes: [stroke])
        let before = NativeCanvasLayout(target: target(w: 500, h: 400), webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        let after = NativeCanvasLayout(target: target(w: 1000, h: 800), webBounds: CGRect(x: 0, y: 0, width: 1200, height: 900))
        let restored = try PKDrawing(data: original.dataRepresentation())
        let resized = restored.transformed(using: try XCTUnwrap(after.resizeTransform(from: before.canvasFrame.size)))
        let cached = try PKDrawing(data: resized.dataRepresentation())
        let sample = try XCTUnwrap(cached.strokes.first)
        let location = sample.path[0].location.applying(sample.transform)
        let source = after.sourcePoint(location)
        let expected = before.sourcePoint(point.location)
        XCTAssertEqual(source.x, expected.x, accuracy: 0.01)
        XCTAssertEqual(source.y, expected.y, accuracy: 0.01)
        XCTAssertEqual(sample.path[0].force, point.force, accuracy: 0.01)
        XCTAssertEqual(after.sourceWidth(sample.path[0].size.width, strokeTransform: sample.transform),
                       before.sourceWidth(point.size.width, strokeTransform: .identity), accuracy: 0.01)
    }
}
