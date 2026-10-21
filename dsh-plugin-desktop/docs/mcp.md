# MCP connections

[中文](mcp.zh.md)

In Settings → Integrations → MCP, choose `stdio` for local commands, `HTTP` for Streamable HTTP, or `SSE` for legacy HTTP+SSE endpoints. SSE uses a desktop-owned bridge process and the existing upstream client for tool discovery, calls, notifications and bounded reconnection. It does not modify the pinned Harness checkout. The bridge is built into the desktop package and requires no extra installation.

Connection names are tool namespaces: use 1–32 ASCII letters, digits, underscores or hyphens, for example `database_term`. Remote URLs require HTTPS; HTTP is allowed for loopback endpoints.

For a Bearer token, click **Add header**, enter `Authorization` as the header name and `Bearer your-token` as its value. Values are masked by default. ClawClaw creates and manages credential references automatically; settings retain only references while the credential store retains the values. When editing, leave a configured value blank to keep it, enter a new value to replace it, or remove the row to remove that header. Replacing a value creates a separate credential so other connections sharing the old one remain unchanged. **Use existing credential (advanced)** lets you select a reference manually. Both HTTP and SSE support the existing OAuth PKCE configuration.

For stdio, click **Add environment variable** and enter a name such as `API_KEY` and its actual value. Environment variables use the same masked inputs, automatic references, keep/replace behavior and advanced reuse option. Environment names are case-sensitive; header names are case-insensitive. Switching transports keeps separate environment and header drafts and saves only the active transport's values. Command arguments are entered one per line; the field includes a multiline example.

Pre-registered OAuth clients also accept their client secret directly. Leave an already configured secret blank to retain it, or enter a replacement; manual reference reuse remains available under the advanced option.

JSON import accepts raw header values and moves them into the credential store:

```json
{
  "mcpServers": {
    "database_term": {
      "type": "sse",
      "url": "http://127.0.0.1:6061/sse",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

Use `type` or `transport` to select `sse`, `stdio`, or `streamable-http` (`http` is an import alias). Without an explicit type, a command selects stdio and a URL selects Streamable HTTP. Unknown or conflicting types are rejected. Select the transport supported by the server; the client does not infer SSE from the URL path or automatically fall back to it.

The add/edit dialog describes each transport before its connection fields. Credential fields are expanded by default; optional OAuth registration and connection tuning stay in disclosures. Validation errors appear beside fields and in a focusable summary. Saving locks the editor to prevent duplicate submissions. A failed connection keeps the persisted settings open for correction; successful saves report tool readiness, pending discovery, disabled state or required authorization separately.
