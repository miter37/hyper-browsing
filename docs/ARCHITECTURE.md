# Hyper-Browsing: Architecture & Technical Specification

> **A comprehensive technical specification of the Hyper-Browsing framework — an adaptive, self-learning AI browser agent that pairs Playwright with an authenticated Google Chrome runtime, built-in dynamic DOM discovery tools, self-healing site assetization, and proactive storage management.**

---

## 1. System Overview & Philosophy

Modern web applications present severe roadblocks to traditional, sandboxed automation engines (e.g. headless Puppeteer, isolated Playwright runners, curl/fetch scrapers):
- **Bot Detection & Client Fingerprinting**: Web Workers checking audio context, canvas hash, and WebGL parameters (Cloudflare Turnstile, PerimeterX, Datadome).
- **Authentication Walls & 2FA**: Frequent logouts, multi-factor authentication, SMS/email verification prompts.
- **Dynamic & Transient DOMs**: Infinite virtual lists where off-screen nodes unmount, live WebSockets, and complex shadow roots.

Hyper-Browsing resolves these fundamental challenges through a **symbiotic assistant paradigm**:
Instead of spawning a synthetic browser in a vacuum, the agent connects directly to the user's authentic **Google Chrome runtime** via Chrome DevTools Protocol (CDP). It leverages persistent user authentication and native browser profiles, executes commands through a modular CLI/RPC architecture, and **self-learns each visited website by creating reproducible script runners (`<site>_runner.mjs`) and declarative knowledge documents (`SKILL.md`)**.

---

## 2. Core Architectural Components

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        User / Agent Instruction                        │
│                 ("Find tickets on site X", "Summarize feed")           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Decision & Dispatch Layer (webctl & SKILL.md Protocol)              │
│    - Checks known site registry: sites/<domain>/site.yaml / SKILL.md   │
│    - Fast-Path: Directly invoke sites/<site>/scripts/<site>_runner.mjs │
│    - Zero-Shot Path: Invoke standard discovery primitives              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼ (Known Fast-Path)             ▼ (Discovery / Fallback)
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│ Standardized Site Runner             │  │ Tooling Suite (tools.mjs)    │
│ (<site>_runner.mjs)                  │  │ - dismiss-annoyances         │
│ - Parametric CLI arguments           │  │ - forms                      │
│ - Deterministic DOM/API logic        │  │ - smart-scroll (Virtual DOM) │
│ - Fail-fast timeouts (3-5s)          │  │ - diff                       │
│ - Safe CDP socket closure            │  │ - sniff-ws / api-sniff       │
│                                      │  │ - user-intervene             │
└──────────────────┬───────────────────┘  └──────────────┬───────────────┘
                   │                                     │
                   └─────────────────┬───────────────────┘
                                     │ (Playwright over CDP :9223)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. Real Chrome Daemon & Session Controller                             │
│    - Mirrors user Chrome profile (persisting cookies & local storage)  │
│    - Anti-bloat flags: disabled component updates & capped cache (32MB)│
│    - Headless by default; instant reveal for human-in-the-loop tasks   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. Target Web Applications (SPAs, Portals, Protected Services)         │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 The Orchestrator: `webctl` & `browserd`
- **`browserd`**: A supervised long-lived background daemon that owns the canonical Chrome process, monitors the CDP port (default `9223`), and provides an authenticated HTTP/RPC bridge for agent sessions.
- **`webctl`**: The deterministic command-line interface. It handles session lifecycles, runs discovery commands, executes declarative actions, and supervises runtime health (`webctl health`).
- **Headless & Reveal Toggle**: The browser runs headless by default for speed and unobtrusiveness. If a human interaction (CAPTCHA, 2FA, biometric approval) is detected, `webctl browser reveal` displays the real desktop window, allowing the user to act before execution resumes.

### 2.2 Proactive Anti-Bloat & Session Safeguard
Unlike standard Chrome instances that accumulate gigabytes of model stores, speech engines, and graphics caches, Hyper-Browsing launches Chrome with strict runtime isolation:
- **WorkingDirectory Isolation**: Process working directory points to `.runtime/chrome-profiles/...`, eliminating cache spillover into the skill root.
- **Flags**:
  - `--disable-component-update`: Prevents background downloads of multi-megabyte language models and TTS engines.
  - `--disable-background-networking`: Inhibits background telemetry and predictive prefetching.
  - `--disable-sync`, `--disable-default-apps`: Halts extraneous synchronization services.
  - `--disk-cache-size=33554432`: Caps browser disk cache to 32MB.
- **Session Preservation (`clean.mjs`)**: Purges GPU, shader, and temporary snapshot caches while strictly protecting `Default/Network/Cookies`.

---

## 3. The 3-Stage Evolution Cycle

### Stage 1: Zero-Shot Discovery & DOM Extraction
When encountering an unfamiliar domain, the agent never dumps the unconstrained DOM (which floods LLM token context). Instead, it queries interactive elements via structured snapshots:
- Filters for interactable tags (`a`, `button`, `input`, `select`, `role=button`).
- Resolves precise bounding boxes for physical CDP mouse dispatch (`Input.dispatchMouseEvent`) rather than relying on brittle synthetic `.click()` events.

### Stage 2: Deep Analysis via the Built-in Tools Suite
The agent leverages 6 primary primitives to navigate complex modern web architectures:
1. **`dismiss-annoyances`**: Removes fixed/sticky overlay backdrops and clicks cookie consent dialogs to unblock pointer events.
2. **`forms`**: Maps complex forms, identifying input roles, labels, and required flags.
3. **`smart-scroll`**: Overcomes Virtual DOM node recycling by accumulating off-screen items into memory.
4. **`diff`**: Compares DOM trees before and after interactions to pinpoint navigation state, modal popups, or server errors.
5. **`api-sniff` / `sniff-ws`**: Directly listens to underlying HTTP/JSON APIs and WebSocket telemetry, avoiding slow UI rendering.
6. **`user-intervene`**: Safely transfers control to the human user for sensitive actions (payments, logins) and resumes upon confirmation.

### Stage 3: Permanent Assetization & Fast-Path
Once an interaction sequence succeeds:
1. The agent encodes structural rules into `sites/<domain>/SKILL.md` (quirks, API endpoints, key selectors).
2. The agent builds a parametric CLI runner at `sites/<domain>/scripts/<site>_runner.mjs`.
3. Subsequent user prompts bypass zero-shot discovery, invoking the script runner directly for sub-second responses.

---

## 4. Self-Healing & Fault Tolerance

```text
Run <site>_runner.mjs
       │
       ▼
Locator Failure / Redesign?
       │
       ├─► [No] ──► Return Results
       │
       └─► [Yes] ──► 1. Fail-Fast (3-5s locator timeout, avoids 30s hang)
                     2. Fallback to Stage 1 & 2 Discovery Primitives
                     3. Solve Task via Alternative Selectors or Backend API
                     4. Self-Healing Patch: Overwrite <site>_runner.mjs
```

Web applications frequently update their DOM hierarchies and CSS class names. Hyper-Browsing avoids catastrophic automation failures via an automated recovery loop:
- **Fail-Fast Locator Timeouts**: Playwright's 30s default timeout is overridden to 3,000–5,000ms. If an element has moved or changed, the failure is signaled immediately.
- **Automatic Fallback to Discovery**: The agent catches the script error and switches to interactive zero-shot inspection.
- **Snapshot Diffing**: Identifies altered selectors, new button roles, or layout refactors.
- **Automated Self-Healing Patch**: Once the task is completed via the fallback path, the agent updates the site runner script and documentation, restoring fast-path execution for all future runs.

---

## 5. Security & Privacy Guarantees

- **No Remote Credential Storage**: All cookies, session tokens, and local storage stay exclusively on the local host under `.runtime/` (which is strictly ignored by `.gitignore`).
- **Human-in-the-Loop Boundaries**: Sensitive write actions (e.g. initiating financial transfers, deleting accounts, submitting final purchase orders) require explicit human confirmation or user intervention.
- **No Secret Leakage**: Runner scripts use generic, parametric inputs and contain zero hardcoded personal handles, addresses, or keys.
