# Installation, CLI and packaging

## Requirements

- Node.js **20 or newer**
- Google Chrome installed locally
- macOS, Linux or Windows

Hyper-Browsing uses Chrome DevTools Protocol (CDP) with the locally installed browser. A separate Playwright Chromium download is not normally necessary.

## Run from source today

\`\`\`bash
git clone https://github.com/miter37/hyper-browsing.git
cd hyper-browsing
npm ci
node bin/hyper-browsing.mjs doctor
node bin/hyper-browsing.mjs browser start
node bin/hyper-browsing.mjs mcp
\`\`\`

Start \`mcp\` from your MCP client; its stdout is protocol-only. To use the CLI directly:

\`\`\`bash
node bin/hyper-browsing.mjs session open --url https://example.com
node bin/hyper-browsing.mjs session list
node bin/hyper-browsing.mjs webctl browser status
\`\`\`

The existing \`./bin/webctl\` and \`bin\\webctl.cmd\` remain supported for skill-based workflows.

## npm/npx entry point

The repository now includes \`bin/hyper-browsing.mjs\` and a production dependency on \`tsx\`, so published packages include what the daemon needs. Once you publish a suitable version to the npm registry and verify the package name:

\`\`\`bash
npx --yes hyper-browsing doctor
npx --yes hyper-browsing mcp
npx --yes hyper-browsing browser start
\`\`\`

**Publication is separate:** \`npx hyper-browsing\` is not guaranteed to work until the package exists in the registry; a GitHub commit or pull request does not publish to npm. Run \`npm pack --dry-run\` and \`npm publish\` in your release workflow after checking package ownership and published contents.

## Stable local state

The npm CLI sets \`WEBAGENT_RUNTIME_DIR\` to \`~/.hyper-browsing\` unless overridden. This keeps local profiles, browserd token, endpoint and logs outside ephemeral npx package caches. Project source scripts retain their existing project-root \`.runtime\` default when invoked directly.

The browser RPC listener binds to \`127.0.0.1\`, requires a local token, and does not expose a remote cloud browser. Avoid sharing runtime directories or MCP process access with untrusted users.

## Developer verification

\`\`\`bash
npm ci
npm run typecheck
npm run test:mcp
npm test
npm pack --dry-run --json
\`\`\`

GitHub Actions runs on Linux and Windows. See [MCP tools and safety](MCP.md).
