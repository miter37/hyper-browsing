# Native MCP integration

Hyper-Browsing exposes its real Chrome automation engine through a **local stdio Model Context Protocol server**. Claude Desktop, Cursor, Claude Code and other MCP-capable clients can invoke structured tools without constructing shell commands.

The MCP adapter uses the existing **token-authenticated localhost BrowserDaemon RPC**. It does not launch a second Playwright browser, bypass confirmation, or copy Chrome cookies to an external service.

## From source (works immediately)

Requires Node.js 20+, installed Google Chrome and local dependencies.

```bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs mcp
```

The MCP process speaks JSON-RPC over stdin/stdout. It is meant to be started by an MCP client, not used as an interactive terminal. The first actual tool call starts or reuses the browser daemon. A source checkout or skill folder keeps runtime state in its own `.runtime`, the same directory `bin/webctl` uses, so the MCP server and the skill CLI share one daemon, Chrome profile and set of sessions. A packaged copy (npx cache, `npm install -g`) stores it in `~/.hyper-browsing` so a cache cleanup does not discard local sessions. Override either with `WEBAGENT_RUNTIME_DIR`.

## Client configuration

For Claude Desktop or Cursor, add a local stdio MCP server entry and replace the absolute path:

```json
{
  "mcpServers": {
    "hyper-browsing": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/hyper-browsing/bin/hyper-browsing.mjs", "mcp"]
    }
  }
}
```

On Windows, use a full path such as `C:\\work\\hyper-browsing\\bin\\hyper-browsing.mjs` (JSON strings require doubled backslashes). The MCP settings location differs by client; use its current "Add MCP server" interface.

**After the npm package is actually published**, an npm-based configuration becomes possible:

```json
{
  "mcpServers": {
    "hyper-browsing": {
      "command": "npx",
      "args": ["--yes", "hyper-browsing", "mcp"]
    }
  }
}
```

The npm package name/availability must be verified at publication time. The repository containing a `bin` field alone does not mean the package has been published.

## Tools

| MCP name | Purpose |
| --- | --- |
| `browser_status` | Inspect Chrome status |
| `session_open`, `session_list`, `session_close` | Manage tabs |
| `navigate`, `back` | Move an existing tab |
| `snapshot`, `list_items`, `forms` | Compact page inspection |
| `read_text` | Read text, values or attributes of elements |
| `screenshot`, `wait_for` | Capture the tab; wait for a text or CSS match |
| `scroll`, `hover` | Reach lazy content and hover menus |
| `smart_scroll` | Accumulate result items during bounded scrolling |
| `dismiss_annoyances` | Evidence-based popup handling |
| `verify` | Read-only page assertions |
| `click`, `fill`, `select`, `press` | Verified actions on observed targets |
| `site_identify`, `learning_notes` | Read what is already known about the site (`guide:<section>` reads a section of the site guide) |
| `site_memory_draft`, `site_memory_save` | See the facts the engine drafted from this session; keep, write or remove site facts |
| `site_repair` | Save a working control or URL template for a saved action that failed |
| `action_list`, `run_saved_action` | Reuse site assets |
| `request_status` | Check uncertain requests without replay |

Content inside iframes is not part of the page's own snapshot. When a page has visible frames, `snapshot` (and a lookup that finds nothing) lists them under `frames`; pass `frame` (a frame name or URL part) to `snapshot`, `list_items`, `read_text`, `click`, `fill` and the other page tools to work inside one. A `ref` observed in a frame can be used without `frame`.

Targets take exactly one of `locator` or `ref`. An ambiguous locator is rejected with its candidates; retry with `nth` (0-based) or `within`. Locator suggestions in results are returned as `locator` objects, ready to pass back as arguments.

**Safety contract:** `click`, `fill`, `press` and `run_saved_action` use the existing shared risk/confirmation engine. If a tool returns `confirmationRequired`, stop and ask the user. Only pass `confirmed: true` for a specific operation that the user has explicitly authorized. No raw arbitrary JavaScript `eval` or unrestricted Node execution is exposed through MCP.

The JSON-RPC protocol includes `initialize`, `ping`, `tools/list`, and `tools/call` over newline-delimited stdio. Browser errors are returned as MCP tool errors rather than silently retried. A lost RPC response reports `outcome_unknown`; use `request_status` or inspect the current page instead of resending a write.

**Scope:** This initial MCP transport covers the core browser primitives and bounded scrolling through the shared daemon, not every optional legacy `scripts/tools.mjs` capability (for example raw WebSocket sniffing). Clients should respect website terms and only automate accounts they are authorized to use.
