# Hyper-Browsing

**Your local Chrome. Agent-native tools. Reusable web intelligence.**

[![CI](https://github.com/miter37/hyper-browsing/actions/workflows/ci.yml/badge.svg)](https://github.com/miter37/hyper-browsing/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-green)
![MCP: stdio](https://img.shields.io/badge/MCP-native%20stdio-purple)

**English** · [한국어](README.ko.md)

> **Hyper-Browsing turns your existing Chrome into a local-first automation runtime for AI agents.**
> It combines compact page inspection, bulk table reading, Playwright actions, login-ready sessions, and **site memory that briefs the agent on every known site** — through a **native MCP server** as well as the original CLI/agent skill.

No hosted browser subscription is required. No separate cloud credential vault. The browser runs on your machine; information you send to an AI model is still subject to that model provider's privacy policy.

## Connect in minutes

| Choose your workflow | Best for |
| --- | --- |
| **Native MCP** | Claude Desktop, Claude Code, Cursor, Hermes and other MCP clients |
| **CLI / agent skill** | Shell automation, coding agents and custom runners |
| **npm / npx CLI** | One-command usage **once the npm package is published** |

### Works now — from source

```bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs doctor
```

Add this stdio server to your MCP client's configuration (replace the path):

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

After **npm publication**, the same integration can use `npx --yes hyper-browsing mcp`. The package is configured for npm distribution; **this GitHub branch is not itself an npm release.** [Installation details](docs/INSTALL.md) · [MCP client setup](docs/MCP.md)

### What you can ask your agent

- “Open the site I'm already signed in to, find the relevant controls, and summarize the latest results.”
- “Search Airbnb for a stay, apply the requested filters, and verify the visible dates before reporting.”
- “Explore a new site, collect its repeated listing cards with smart scroll, and save what worked with site_knowledge_save for next time.”
- “Read the whole results table, keep rows with value over $700K, and add each company's market cap.”
- “Reuse the registered site action when possible; if the UI changed, observe the current page and recover rather than blindly retrying.”

## Why Hyper-Browsing?

| Capability | What it means |
| --- | --- |
| **Native MCP, not a shell-command recipe** | Structured tools for sessions, snapshots, forms, actions, verification and saved workflows |
| **Real local Chrome** | Chrome DevTools Protocol connection and persistent local profile state |
| **Less observation noise** | Compact, targeted DOM inspection; whole tables and grids in one read |
| **Site memory** | Known sites brief the agent on arrival; proven workflows run in one call and repair themselves |
| **Safer execution** | Ambiguity checks, pinned refs, effect reporting, write confirmation and no blind retries |
| **Cross-platform** | Node.js 20+, Windows, macOS and Linux |
| **No hosted browser dependency** | Run locally without a required paid browser infrastructure service |

### The three-stage approach

```text
Inspect a new site  →  Interact & verify  →  Reuse the successful path
       snapshot            click / fill          site-specific actions
       forms / list        diff / verify         recorded knowledge
       smart-scroll        risk checks           recovery on UI change
```

A task can finish without saving anything. Learning is deliberately bounded: concise notes first; action recording after repeated independent use; shallow overviews only for recurrent sites. See [learning and recovery](docs/LEARNING.md).

## Native MCP server

Hyper-Browsing ships its own **MCP server** (stdio). Any MCP client — Claude Code, Claude Desktop, Cursor, Hermes — gets the browser as typed tools: no shell recipes, no flags to assemble. Start it with `node bin/hyper-browsing.mjs mcp` (setup in [Connect in minutes](#connect-in-minutes)).

```text
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
```

MCP is an **adapter to the same daemon** the CLI uses, not a second engine: target resolution, risk classification, request IDs and verification are identical whichever client calls.

### Tools

| Group | Tools |
| --- | --- |
| Browser & sessions | `browser_status` · `browser_doctor` · `session_open` · `session_list` · `session_close` · `navigate` · `back` |
| Look at the page | `snapshot` · `forms` · `list_items` · `smart_scroll` · `scroll` · `screenshot` · `wait_for` · `dismiss_annoyances` |
| **Read in bulk** | `read_table` · `page_data` · `run_script` · `read_text` |
| Act & verify | `click` · `fill` · `select` · `press` · `hover` · `verify` · `request_status` |
| **Site memory** | `site_identify` · `action_list` · `run_saved_action` · `learning_notes` · `site_knowledge_save` · `site_repair` · `site_memory_draft` · `site_memory_save` |

### What the MCP server does for you

- **Bulk reading, few calls.**
  - `read_table` returns a whole table or grid as compact TSV rows. A `where` filter (`Value >= 700000`, `Market Cap >= 10B`) runs inside the page, and long tables page with `offset`/`nextOffset`. It also reads grids drawn on a canvas or virtualised, whose zero-size cells ordinary element reads cannot see.
  - `page_data` reads the JSON the page itself loaded from its own site, plus JSON embedded in its HTML.
  - `run_script` runs a **read-only** page script to collect many values at once. Anything that could change the page or the site — clicks, typing, events, DOM edits, POST, storage, navigation, `eval` — is refused before it runs.
- **Several agents at once.**
  - Every session gets its own background window in one shared, signed-in Chrome.
  - Sessions of different agents run side by side; Chrome-wide operations wait and run alone.
  - `session_open {isolated: true}` starts at most one extra Chrome with a copy of the login.
- **Self-healing browser.** `browser_doctor {fix: true}` diagnoses and repairs safely:
  - it reattaches to the running Chrome, relaunches only a dead one, and clears stale locks;
  - it restores the login from backup when it is missing.

  It never kills unrelated processes or deletes profiles.
- **Small, honest results.** Ad frames are counted, not listed. Uncertain outcomes are reported as such and never blindly replayed.

**Important:** state-changing actions require specific user authorization; `confirmed: true` is **not** blanket approval. Unrestricted JavaScript and Node code execution are **not exposed** — `run_script` accepts read-only scripts only. See the [MCP guide and safety contract](docs/MCP.md).

## Site memory: learn a site once, reuse it every time

The first visit to a site is exploration; later visits should not be. Hyper-Browsing keeps **per-site memory** in `sites/<site>/` — a short guide plus runnable actions — and **pushes it to the agent automatically**.

| | What happens |
| --- | --- |
| **Briefing on arrival** | Opening a known site returns its guide and saved actions with the first result, so the agent starts from what already worked. 40+ sites ship with memory (Amazon, Airbnb, Booking, LinkedIn, Zillow, finviz, Naver, Wikipedia, YouTube …). |
| **One-call saved actions** | `run_saved_action` replays a proven workflow through the same risk and verification engine. Actions can be **page scripts** (`op: script`) that run without enabling privileged code actions, and can read several pages in one call with same-site GET fetches. |
| **Save what worked** | After finishing a task by hand, `site_knowledge_save` writes the guide sections and actions in one call. It creates the site if it is new. URLs and selectors become templates and elements, a read action is test-run before it is kept, and off-site URLs are refused. Closing a session after many manual steps suggests saving. |
| **Repair instead of relearn** | When a site changes, `site_repair` swaps the broken element or URL template for the one that just worked. Later runs use the fix; failing actions are tracked and revalidated. |
| **Small facts, too** | `learning_notes`, `site_memory_draft` and `site_memory_save` keep short verified facts, such as which URL parameter a filter sets or where a control lives. |

Example — finviz insider buying. Without memory, the agent opens the insider page and the quote pages one by one. With memory, it makes a single call:

```text
run_saved_action insider_trades {"minValue": 700000, "minMarketCap": "10B"}
→ large-cap insider purchases ≥ $700K with each company's market cap, ~5 s
```

No typed text or personal data is stored in site memory. See [learning and recovery](docs/LEARNING.md).

## See it in action

**Known site — execute a previously prepared workflow**

![Airbnb ready-made workflow](https://raw.githubusercontent.com/miter37/hyper-browsing/main/assets/rec_airbnb.gif)

**New site — explore with built-in inspection tools**

![First-time Investing.com exploration](https://raw.githubusercontent.com/miter37/hyper-browsing/main/assets/rec_investing.gif)

These are examples of the legacy CLI/skill workflow. Actual latency, site compatibility and account requirements vary; no universal speedup is claimed.

## Command-line quick reference

```bash
node bin/hyper-browsing.mjs doctor
node bin/hyper-browsing.mjs browser start
node bin/hyper-browsing.mjs session open --url https://example.com
node bin/hyper-browsing.mjs session list
node bin/hyper-browsing.mjs mcp
```

A packaged install keeps runtime data at `~/.hyper-browsing`; a source checkout or skill folder uses its own `.runtime`, shared by MCP and `bin/webctl` (override via `WEBAGENT_RUNTIME_DIR`). The existing `./bin/webctl` and Windows `bin\\webctl.cmd` remain compatible. [Full command reference](docs/COMMANDS.md).

## Safety, privacy and transparency

- Browser RPC is restricted to localhost and token authenticated; the MCP server uses local stdio transport.
- Session cookies and browser profiles stay in local runtime storage. **Page data returned to your connected agent may be processed by its model provider.**
- Ambiguous actions are refused. A request with an uncertain outcome is observed or checked by request ID, **not blindly replayed**.
- `webctl eval` is disabled by default and requires explicit opt-in plus confirmation. Node code actions are also disabled by default because they are privileged local programs. The regex source scan is not a sandbox.
- Your local Chrome must be installed. CAPTCHA, login and two-factor prompts may require human intervention. Website terms and account permissions still apply.

## Build and contribute

```bash
npm ci
npm run typecheck
npm run test:mcp
npm test
npm pack --dry-run --json
```

Linux/Windows CI checks this project on push/PR; see [CI workflow](.github/workflows/ci.yml). Issues, contributions and reproducible browser failures are welcome.

**[MCP guide](docs/MCP.md) · [Browser runtime](docs/BROWSER.md) · [Learning](docs/LEARNING.md) · [Install and distribute](docs/INSTALL.md) · [Architecture](docs/ARCHITECTURE.md) · [Full CLI](docs/COMMANDS.md) · [한국어 문서](README.ko.md)**

MIT License. Hyper-Browsing is an independent open-source project.
