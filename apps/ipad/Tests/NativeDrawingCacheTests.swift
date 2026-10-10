import XCTest
@testable import RDesign
final class NativeDrawingCacheTests: XCTestCase {
    func testSameImportedFrameIdCannotReuseAnotherProjectOrBridgeCache() {
        let a = NativeDraftIdentity(projectId: "project-a", frameId: "cloned-frame")
        let b = NativeDraftIdentity(projectId: "project-b", frameId: "cloned-frame")
        let bridge = URL(string: "https://desktop.example/project/project-a")!
        XCTAssertNotEqual(a.filename(bridgeURL: bridge), b.filename(bridgeURL: bridge))
        XCTAssertNotEqual(a.filename(bridgeURL: bridge), a.filename(bridgeURL: URL(string: "https://other.example")!))
        XCTAssertEqual(a.filename(bridgeURL: bridge), a.filename(bridgeURL: URL(string: "https://desktop.example:443/editor")!))
    }
    func testLegacyDraftDecodesButCannotRestoreIntoKnownProject() throws {
        let json = #"{"frameId":"cloned-frame","drawing":"","width":100,"height":80}"#
        let draft = try JSONDecoder().decode(NativeDrawingDraft.self, from: Data(json.utf8))
        XCTAssertTrue(draft.matches(NativeDraftIdentity(projectId: nil, frameId: "cloned-frame")))
        XCTAssertFalse(draft.matches(NativeDraftIdentity(projectId: "project-a", frameId: "cloned-frame")))
    }
}
