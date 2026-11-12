# Hyper-Browsing

**Your local Chrome. Agent-native tools. Reusable web intelligence.**

[![CI](https://github.com/miter37/hyper-browsing/actions/workflows/ci.yml/badge.svg)](https://github.com/miter37/hyper-browsing/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-green)
![MCP: stdio](https://img.shields.io/badge/MCP-native%20stdio-purple)

**English** · [한국어](README.ko.md)

> **Hyper-Browsing turns your existing Chrome into a local-first automation runtime for AI agents.**
> It combines compact page inspection, Playwright actions, login-ready sessions, and reusable site-specific knowledge — now through a **native MCP server** as well as the original CLI/agent skill.

No hosted browser subscription is required. No separate cloud credential vault. The browser runs on your machine; information you send to an AI model is still subject to that model provider's privacy policy.

## Connect in minutes

| Choose your workflow | Best for |
| --- | --- |
| **Native MCP** | Claude Desktop, Claude Code, Cursor, Hermes and other MCP clients |
| **CLI / agent skill** | Shell automation, coding agents and custom runners |
| **npm / npx CLI** | One-command usage **once the npm package is published** |

### Works now — from source

\`\`\`bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs doctor
\`\`\`

Add this stdio server to your MCP client's configuration (replace the path):

\`\`\`json
{
  "mcpServers": {
    "hyper-browsing": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/hyper-browsing/bin/hyper-browsing.mjs", "mcp"]
    }
  }
}
\`\`\`

After **npm publication**, the same integration can use \`npx --yes hyper-browsing mcp\`. The package is configured for npm distribution; **this GitHub branch is not itself an npm release.** [Installation details](docs/INSTALL.md) · [MCP client setup](docs/MCP.md)

### What you can ask your agent

- “Open the site I'm already signed in to, find the relevant controls, and summarize the latest results.”
- “Search Airbnb for a stay, apply the requested filters, and verify the visible dates before reporting.”
- “Explore a new site, collect its repeated listing cards with smart scroll, and remember a proven read workflow for next time.”
- “Reuse the registered site action when possible; if the UI changed, observe the current page and recover rather than blindly retrying.”

## Why Hyper-Browsing?

| Capability | What it means |
| --- | --- |
| **Native MCP, not a shell-command recipe** | Structured tools for sessions, snapshots, forms, actions, verification and saved workflows |
| **Real local Chrome** | Chrome DevTools Protocol connection and persistent local profile state |
| **Less observation noise** | Compact, targeted DOM inspection instead of dumping every page node |
| **Learn once, reuse carefully** | Site knowledge and runnable actions can be saved and revalidated |
| **Safer execution** | Ambiguity checks, pinned refs, effect reporting, write confirmation and no blind retries |
| **Cross-platform** | Node.js 20+, Windows, macOS and Linux |
| **No hosted browser dependency** | Run locally without a required paid browser infrastructure service |

### The three-stage approach

\`\`\`text
Inspect a new site  →  Interact & verify  →  Reuse the successful path
       snapshot            click / fill          site-specific actions
       forms / list        diff / verify         recorded knowledge
       smart-scroll        risk checks           recovery on UI change
\`\`\`

A task can finish without saving anything. Learning is deliberately bounded: concise notes first; action recording after repeated independent use; shallow overviews only for recurrent sites. See [learning and recovery](docs/LEARNING.md).

## One browser engine. Multiple entry points.

\`\`\`text
Claude / Cursor / Hermes   Other agents / shell
         |                        |
    MCP (stdio)               CLI / SKILL.md
         +-----------+------------+
                     |
          Authenticated local RPC
                     |
             BrowserDaemon
          Playwright + Chrome CDP
                     |
        Your local Chrome profile
\`\`\`

MCP is an **adapter to the existing daemon**, not a second automation engine. The same target resolution, safety classification, request IDs, and verification rules apply regardless of client.

### MCP tool highlights

\`browser_status\` · \`session_open\` · \`snapshot\` · \`forms\` · \`list_items\` · \`smart_scroll\` · \`dismiss_annoyances\` · \`click\` · \`fill\` · \`select\` · \`press\` · \`verify\` · \`action_list\` · \`run_saved_action\` · \`request_status\`

**Important:** state-changing actions require specific user authorization. \`confirmed: true\` is **not** blanket approval. Raw JavaScript evaluation and unrestricted Node code execution are **not exposed** by the MCP adapter. See the [MCP safety contract](docs/MCP.md).

## See it in action

**Known site — execute a previously prepared workflow**

![Airbnb ready-made workflow](assets/rec_airbnb.gif)

**New site — explore with built-in inspection tools**

![First-time Investing.com exploration](assets/rec_investing.gif)

These are examples of the legacy CLI/skill workflow. Actual latency, site compatibility and account requirements vary; no universal speedup is claimed.

## Command-line quick reference

\`\`\`bash
node bin/hyper-browsing.mjs doctor
node bin/hyper-browsing.mjs browser start
node bin/hyper-browsing.mjs session open --url https://example.com
node bin/hyper-browsing.mjs session list
node bin/hyper-browsing.mjs mcp
\`\`\`

The npm entry point retains runtime data at \`~/.hyper-browsing\` (override via \`WEBAGENT_RUNTIME_DIR\`). The existing \`./bin/webctl\` and Windows \`bin\\webctl.cmd\` remain compatible. [Full command reference](docs/COMMANDS.md).

## Safety, privacy and transparency

- Browser RPC is restricted to localhost and token authenticated; the MCP server uses local stdio transport.
- Session cookies and browser profiles stay in local runtime storage. **Page data returned to your connected agent may be processed by its model provider.**
- Ambiguous actions are refused. A request with an uncertain outcome is observed or checked by request ID, **not blindly replayed**.
- \`webctl eval\` is disabled by default and requires explicit opt-in plus confirmation. Node code actions are also disabled by default because they are privileged local programs. The regex source scan is not a sandbox.
- Your local Chrome must be installed. CAPTCHA, login and two-factor prompts may require human intervention. Website terms and account permissions still apply.

## Build and contribute

\`\`\`bash
npm ci
npm run typecheck
npm run test:mcp
npm test
npm pack --dry-run --json
\`\`\`

Linux/Windows CI checks this project on push/PR; see [CI workflow](.github/workflows/ci.yml). Issues, contributions and reproducible browser failures are welcome.

**[MCP guide](docs/MCP.md) · [Install and distribute](docs/INSTALL.md) · [Architecture](docs/ARCHITECTURE.md) · [Full CLI](docs/COMMANDS.md) · [한국어 문서](README.ko.md)**

MIT License. Hyper-Browsing is an independent open-source project.
