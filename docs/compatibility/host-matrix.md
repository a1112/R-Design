# Platform compatibility and evidence

Documentation checked 2026-10-08. Product specification targets and native features are kept separate from measured delivery.

| Surface | Implemented path | Verification boundary |
| --- | --- | --- |
| Desktop browser | Authorized Bridge and full shared workbench | Browser integration acceptance suite |
| Local MCP stdio | Thirteen `rd_*` tools, structured errors, project listing/opening and Bridge-only calls | In-memory MCP client suite; actual host installation remains manual |
| Codex plugin | Portable root `plugin.json`, `mcp.json`, three skills | Manifest parsed locally; host plugin installation unverified |
| Embedded MCP Apps | External workbench fallback returned by `rd_render_workspace` | No claim of embedded UI support; host domain/media capabilities unverified |
| iPad shell | SwiftUI + WKWebView + PencilKit overlay, raw draft cache and shared samples | Simulator compile; real Pencil/IME/multitasking acceptance is pending |
| AgentProvider | Independently authorized SDK worker, journal, strict candidate permission profile and lease generation | Mock SDK runner and loopback HTTP tests; no paid SDK run performed |
| AssetProvider | Server-only OpenAI Images adapter with explicit approval, bounded output, journal | Mock API tests; no paid generation performed |

[OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins) specifies portable manifests at the package root and transport declarations in `mcp.json`. This repository targets local authoring, with a PATH launcher configured by the operator. Public directory distribution requires a separately approved HTTPS MCP integration.

[OpenAI MCP Apps UI documentation](https://developers.openai.com/plugins/build/chatgpt-ui) describes resource templates, bridge messages and domain allowlists. The implemented fallback avoids claiming the current host supports full embedded editors. Tool responses provide the authorized project browser entry without credentials.

[Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk) supports server-side local threads and resumption. R-Design's host-driven tool workflow never starts another executor. The optional `apps/agent-worker` implements that documented SDK with its own explicit API key, isolated CLI configuration and candidate permission profile; this checkout does not reach into host sessions or private credential stores.

[OpenAI Image generation](https://developers.openai.com/api/docs/guides/image-generation) supports image generation endpoints, output format controls and base64 result bytes. Generated assets remain visual assets, separate from implemented interactive controls. The adapter requires an explicit model and administrator-maintained per-request cost ceiling; provider pricing and hard account billing limits remain provider settings, not inferred guarantees.

[Apple PencilKit data model](https://developer.apple.com/videos/play/wwdc2020/10148/) exposes drawings, transformed strokes and interpolation. Native shared points use interpolated paths; raw PKDrawing is retained to preserve native data that the shared polyline cannot express. Real iPad input behavior is a separate test requirement.

The built-in Bridge can opt into TLS with `RDESIGN_HOST`, `RDESIGN_TLS_CERT`, `RDESIGN_TLS_KEY`, and `RDESIGN_PUBLIC_ORIGIN`. Remote bootstrap is denied; remote device pairing is restricted to the configured HTTPS origin. The iPad uses standard WKWebView certificate validation, with no certificate-error bypass. Certificate issuance and actual iPad trust installation remain operator deployment work.
