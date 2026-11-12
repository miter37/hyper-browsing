# Hermes Agent drop-in installation

Extract this entire folder as:

```text
~/.hermes/skills/adaptive-web-agent/
```

The important path is `~/.hermes/skills/adaptive-web-agent/SKILL.md`.

Then start a new Hermes session (or reset the current one so skills are rescanned). No manual
`npm install` and no manual `browserd` startup is required: the first invocation bootstraps
dependencies and starts the daemon automatically.

Requirements: Node.js 20+ with npm, an installed Google Chrome or Chromium, and network access
on first use to install npm packages.

## Command path

| Platform | Command |
| --- | --- |
| macOS / Linux / Git Bash | `~/.hermes/skills/adaptive-web-agent/bin/webctl` |
| Windows cmd / PowerShell | `%USERPROFILE%\.hermes\skills\adaptive-web-agent\bin\webctl.cmd` |

Both wrappers call the same cross-platform Node launcher (`scripts/launcher.mjs`), so behaviour
is identical on every platform. `node scripts/launcher.mjs webctl <args>` also works directly.

## Chrome profile

No profile selection is required. v0.3 auto-detects **the first Chrome profile on the machine**
and drives that; cookies and local storage persist across sessions.

Chrome runs **headless (no visible window) by default.** When something needs a human - a login
wall, CAPTCHA, 2FA - run `webctl browser reveal` to open a real visible window, and `webctl
browser hide` to go back to headless afterward. Open tabs survive either switch.

Because Chrome 136+ ignores remote-debugging switches on the real profile directory, the agent
normally runs that profile from its own user-data directory under
`.runtime/chrome-profiles/`. `webctl browser status` reports the active directory and the
reason it was chosen.

The agent never closes the user's own Chrome. It only reclaims Chrome processes that it started
itself against an agent-owned directory.

```bash
webctl browser profiles                    # list profiles; index 0 is the first
webctl browser use --profile "Profile 2"   # pin a specific profile
webctl browser use --auto                  # back to the first profile
```

## Learning persistence

Unknown-site discovery auto-creates site scaffolds, and successful read extractions auto-encode
reusable actions. When a command reports `learning_pending: true`, run
`webctl learning status --session <id>` and encode the discovery before reporting completion.

## If startup fails

```bash
webctl browser status
webctl browser repair
tail -n 100 ~/.hermes/skills/adaptive-web-agent/.runtime/browserd.log
```

The daemon port defaults to 3219 and moves to the next free port when that one is taken. Set
`WEBAGENT_PORT` to pin it. Generated site knowledge stays under `sites/<site>/`; runtime browser
profiles, observations, metrics, and logs stay under `.runtime/` and should not be committed or
shared.

## Native MCP integration (optional)

Hyper-Browsing now includes a **local stdio MCP server** in addition to its existing skill/CLI workflow. Use it if your Hermes environment supports configuring local MCP servers. Register the executable as:

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

This is a generic MCP client example, **not** a claim that every Hermes version loads this JSON directly. Follow your Hermes version's MCP configuration guidance. The published npm CLI (`npx hyper-browsing@0.4.0 mcp`) is planned, not already published. The skill/CLI installation above continues to work unchanged. [MCP tools and security notes](docs/MCP.md).
