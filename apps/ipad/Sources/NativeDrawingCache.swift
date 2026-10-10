import Foundation
import CryptoKit

/// A frozen frame ID alone is not unique after a project is imported or cloned.
struct NativeDraftIdentity: Equatable {
    let projectId: String?
    let frameId: String
    func filename(bridgeURL: URL) -> String {
        let material: Data
        if let projectId {
            var origin = URLComponents()
            origin.scheme = bridgeURL.scheme?.lowercased()
            origin.host = bridgeURL.host?.lowercased()
            origin.port = bridgeURL.port
            if (origin.scheme == "https" && origin.port == 443) || (origin.scheme == "http" && origin.port == 80) { origin.port = nil }
            // JSON encoding keeps delimiters in imported IDs from colliding.
            material = try! JSONEncoder().encode(["v2", origin.string ?? "", projectId, frameId])
        } else {
            // Existing single-project hosts retain their original cache location.
            material = Data((bridgeURL.absoluteString + ":" + frameId).utf8)
        }
        return SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined() + ".json"
    }
}
struct NativeDrawingDraft: Codable {
    let frameId: String
    let projectId: String?
    let drawing: Data
    let width: Double
    let height: Double
    func matches(_ identity: NativeDraftIdentity) -> Bool { frameId == identity.frameId && projectId == identity.projectId }
}
