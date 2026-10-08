# Local Codex plugin

Install dependencies in the R-Design repository, run its Bridge, then add this folder as a local plugin in a host supporting portable Agent Plugins. The package uses root `plugin.json` and `mcp.json`. For the stdio launch, add this folder's `bin` directory to the host process PATH and set `RDESIGN_HOME` to the absolute repository directory. Restart the host after changing its process environment. Run `rdesign-mcp` directly to check startup; stdout is reserved for MCP JSON-RPC.

`RDESIGN_BRIDGE_URL` defaults to `http://127.0.0.1:4310`. Loopback connections use the Bridge's local bootstrap; remote connections require HTTPS and an explicit `RDESIGN_BRIDGE_TOKEN` issued to an authorized device. Never commit tokens to plugin manifests. Tool outputs contain no credentials. `rd_render_workspace` opens the same project in the complete browser workbench with pairing as needed.

This package is a local authoring target. Plugin installation and embedded MCP Apps UI in Codex or ChatGPT have not been tested by this repository's automated suite. The external browser workbench is the implemented fallback. Public publishing requires a separately reviewed HTTPS MCP deployment and suitable authorization; this manifest does not deploy it.
