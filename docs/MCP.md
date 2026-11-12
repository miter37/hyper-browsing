# Native MCP + CLI setup

**Hyper-Browsing connects AI agents to a local Chrome browser with a standard MCP stdio server.** The MCP adapter translates typed tool arguments into authenticated localhost RPC calls to the existing BrowserDaemon. It does not create a second Playwright driver or an HTTP endpoint on a public interface.

> Release status: the source implementation is available in the feature branch. The npm package contains a new `bin` and is prepared for publishing, **but an npm release is not part of this change**. The `npx` instructions below apply only after the owner publishes the vetted release.

## Requirements

- Node.js **20 or later**
- Installed Google Chrome (browser use and live tests; MCP discovery and handshake can start without it)
- An MCP host with **stdio** server support, e.g. Claude Desktop, Cursor, Claude Code or Hermes with a compatible MCP connector

## Source checkout (available now)

```bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs init
node bin/hyper-browsing.mjs doctor
```

Use the source launcher in your MCP client:

```json
{
  "mcpServers": {
    "hyper-browsing": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/hyper-browsing/bin/hyper-browsing.mjs", "mcp"]
    }
  }
}
```

Replace the path with an absolute path to your local checkout. For Windows, forward slashes such as `C:/Users/you/hyper-browsing/bin/hyper-browsing.mjs` are valid in this JSON.

The host starts the MCP process automatically. You can inspect its handshake from the MCP Inspector or a compatible client; the process uses **stdout only for JSON-RPC**, and it connects to BrowserDaemon on the first tool call. Logs and setup errors stay off the protocol channel.

## npx / npm usage after publication

```bash
npx -y hyper-browsing@0.4.0 init
npx -y hyper-browsing@0.4.0 doctor
npx -y hyper-browsing@0.4.0 mcp
```

```json
{
  "mcpServers": {
    "hyper-browsing": {
      "command": "npx",
      "args": ["-y", "hyper-browsing@0.4.0", "mcp"]
    }
  }
}
```

**This is a proposed release flow, not an assertion that the package currently exists in the registry.** Publishing must be performed by an authorized package owner, and the package-name ownership should be confirmed first.

## Tools exposed via MCP

The native adapter has **23** typed tools. They call the same daemon methods as the existing CLI.

| Tool | Purpose |
|---|---|
| `hb_health`, `hb_browser_status` | Daemon health, Chrome and sessions |
| `hb_session_open`, `hb_session_list`, `hb_session_close` | Open/list/close a specific tab; closing requires explicit approval |
| `hb_goto` | Navigate to an absolute HTTP(S) URL |
| `hb_snapshot` | Compact DOM/interactive-element snapshot, with temporary refs |
| `hb_forms` | Field labels, types, required flags and submit controls |
| `hb_list` | Repeated item titles, URLs and excerpts |
| `hb_scroll`, `hb_smart_scroll` | Scroll and accumulate observed items across bounded virtual DOM updates |
| `hb_dismiss_annoyances` | Dismiss supported overlays without forced hiding |
| `hb_click`, `hb_hover`, `hb_fill`, `hb_select`, `hb_press` | Interact with a pinned ref or a uniquely resolved semantic locator |
| `hb_verify` | Read-only assertions: APPLIED, NOT_APPLIED or UNKNOWN |
| `hb_action_list`, `hb_action_run` | Discover and execute saved site actions with validation |
| `hb_request_status` | Read an earlier request outcome **without replaying it** |
| `hb_browser_reveal`, `hb_browser_hide` | Switch visible/headless Chrome with explicit approval |

Example high-level workflow for your agent:

1. Call `hb_session_open` with an HTTP(S) URL; keep the returned `sessionId`.
2. Observe using `hb_snapshot` or `hb_forms`. Prefer the temporary `ref` given by the current snapshot.
3. Call `hb_fill` / `hb_click` only on the intended unique target.
4. Call `hb_verify` with explicit expectations, or inspect a new snapshot if the screen changed.
5. For a feed where items disappear when scrolled offscreen, call `hb_smart_scroll` with a bounded `maxScrolls` and `limit`. The result explicitly marks observation as **non-exhaustive**.

## Security and approval contract

- **Not a sandbox.** AI tools can operate a logged-in browser. Configure only trusted MCP clients and review all requested actions.
- The daemon binds to **127.0.0.1** and requires a local token. MCP stdio itself does not accept public network connections.
- `hb_click`, `hb_press`, and submitting `hb_fill` use the daemon's write risk classification. For external writes, deletion and unknown operations, the daemon can return `confirmationRequired`. Set `confirmed=true` **only after the person has authorized that specific action**; tool annotations alone are not user authorization.
- Closing a tab and switching Chrome visibility require `approved=true` after user authorization. Never close every tab as part of routine MCP cleanup.
- `hb_dismiss_annoyances` never enables force-hide from MCP. CAPTCHA, 2FA and passwords are not automatically bypassed.
- Raw page JavaScript evaluation is intentionally **not exposed** through MCP. The privileged CLI `eval` feature remains opt-in via `WEBAGENT_ALLOW_UNSAFE_EVAL=1` and `--confirm`. Saved TypeScript code actions remain opt-in via `WEBAGENT_ALLOW_CODE_ACTIONS=1` and run with local Node.js privileges.
- Page content provided to an AI agent may be sent to that agent's model provider. Cookies, local Chrome profile files, the daemon token and runtime history are not uploaded to a Hyper-Browsing server.
- On transport uncertainty, inspect `requestId` with `hb_request_status`, then observe the page. **Never blindly repeat a write, order, post or payment.** If the daemon is no longer running, request status is unavailable and the result remains unknown.

## Local workspace and lifecycle

| Invocation | Default persistent state |
|---|---|
| `node bin/hyper-browsing.mjs ...` or published npm CLI | `~/.hyper-browsing/runtime`, `~/.hyper-browsing/sites`, `~/.hyper-browsing/generated` |
| Original `./bin/webctl` or `node scripts/launcher.mjs webctl` | Repository-local `.runtime/`, `sites/` and `.generated/` unless overridden |

New package CLI initialization copies missing bundled site definitions into the persistent workspace but does not overwrite user modifications. On systems that permit it, supporting runtime scripts are linked into the workspace. This is local only; no cloud account is needed.

Configuration:

```bash
# Set the package CLI workspace explicitly
export WEBAGENT_WORKSPACE_DIR="$HOME/.hyper-browsing"

# Optional fine-grained overrides
# WEBAGENT_RUNTIME_DIR=/private/runtime
# WEBAGENT_SITES_DIR=/private/sites
# WEBAGENT_GENERATED_DIR=/private/generated

# Do not launch Chrome automatically from the MCP process
# WEBAGENT_MCP_AUTOSTART=0
```

`WEBAGENT_MCP_AUTOSTART=0` means a daemon must already be running. The request-status tool never auto-starts a new daemon even if auto-start is otherwise enabled.

## CLI commands

```bash
node bin/hyper-browsing.mjs --help
node bin/hyper-browsing.mjs --version
node bin/hyper-browsing.mjs init
node bin/hyper-browsing.mjs doctor
node bin/hyper-browsing.mjs mcp
node bin/hyper-browsing.mjs webctl session open --url https://example.com
node bin/hyper-browsing.mjs webctl snapshot --session SESSION_ID
```

The original CLI and site scripts are still supported from a repository checkout. For the complete CLI command reference, see [COMMANDS.md](COMMANDS.md). For Chrome profile behavior and headed fallback, see [BROWSER.md](BROWSER.md).

## Troubleshooting

| Symptom | Check |
|---|---|
| MCP tools not shown | Use `mcp` as the CLI subcommand; configure an absolute path and restart the MCP host |
| Unexpected text on MCP stdout | Do not wrap the command with a script that prints banners; use the published CLI or `node bin/hyper-browsing.mjs mcp` directly |
| Chrome not found / login required | Run `doctor`, check Chrome installation, use `hb_browser_reveal` after approval |
| No daemon with auto-start disabled | Start `node bin/hyper-browsing.mjs browserd`, or remove `WEBAGENT_MCP_AUTOSTART=0` |
| Old ref / ambiguous target | Re-observe with `hb_snapshot` and choose a unique new ref; do not guess |
| `outcome_unknown` | Use `hb_request_status` and an observation, not a retry |
| npx can't find the package | The package may not yet be published. Use the source checkout instructions above |

## Development validation

```bash
npm ci
npm run typecheck
npm run test:mcp
npm test
npm pack --dry-run --json
```

The GitHub Actions matrix checks Linux and Windows. npm publishing, signing, registry ownership and release notes are intentionally separate from CI.
