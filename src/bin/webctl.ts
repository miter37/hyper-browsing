#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import { getConfig } from "../config";
import { BrowserdClient } from "../browserd/client";
import { buildRegistry } from "../registry/build";
import { initSite } from "../site-scaffold";
import { metricsSummary } from "../runtime/metrics";
import { loadSite } from "../engine/site-loader";
import { detectStateOffline } from "../engine/offline";
import { validateSites } from "../site-validate";
import { recordBaseline, baselineSummary } from "../runtime/baseline";
import type { PageSnapshot } from "../runtime/snapshot";

const config = getConfig();
const client = new BrowserdClient(config);
const argv = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function boolFlag(name: string): boolean { return argv.includes(`--${name}`); }
function required(name: string): string {
  const v = flag(name);
  if (!v) throw new Error(`Missing --${name}`);
  return v;
}
function locatorFromFlags() {
  const role = flag("role");
  const name = flag("name");
  const testId = flag("testid");
  const text = flag("text");
  const label = flag("label");
  const placeholder = flag("placeholder");
  const css = flag("css");
  const primary = [role, testId, text, label, placeholder, css].filter(Boolean);
  if (primary.length !== 1) throw new Error("Specify exactly one of --role, --testid, --text, --label, --placeholder, --css");
  return { role, name, testId, text, label, placeholder, css, exact: boolFlag("exact") };
}
function print(value: unknown) { process.stdout.write(JSON.stringify(value, null, 2) + "\n"); }

function help() {
  console.log(`Adaptive Web Agent CLI

Daemon/session:
  webctl health
  webctl browser status
  webctl browser repair
  webctl browser profiles
  webctl browser use (--profile NAME | --auto | --managed | --real | --user-data-dir DIR)
  webctl browser reveal               # open a visible Chrome window (for login/CAPTCHA/help)
  webctl browser hide                 # go back to headless (the default)
  webctl session open [--url URL]
  webctl session list
  webctl session close --session ID
  webctl session close --all           # close every open tab (cleanup sweep)

Discovery primitives (same browser session):
  webctl snapshot --session ID [--save]
  webctl screenshot --session ID [--full-page]
  webctl network start --session ID
  webctl network stop --session ID
  webctl goto --session ID --url URL
  webctl click --session ID <locator flags> [--confirm] [--force]
  webctl fill --session ID <locator flags> --value TEXT
  webctl press --session ID [<locator flags>] --key KEY
  webctl extract --session ID <locator flags> [--read text|value|attribute] [--attribute NAME]
  webctl dismiss-annoyances --session ID
  webctl forms --session ID
  webctl diff --session ID --before SNAPSHOT_FILE_OR_JSON
  webctl api-sniff --session ID [--duration-ms MS]
  webctl wait-idle --session ID [--timeout-ms MS]

Knowledge/known mode:
  webctl identify --session ID
  webctl actions --session ID
  webctl run ACTION --session ID [--input JSON] [--confirm] [--site SITE_ID]
  webctl site init --id SITE_ID (--host HOST | --session ID) [--name NAME]
  webctl registry build
  webctl site validate [--id SITE_ID]
  webctl learning status --session ID
  webctl metrics summary
  webctl baseline record --task NAME --duration-ms N --success true|false [--site SITE] [--llm-calls N] [--browser-actions N] [--notes TEXT]
  webctl baseline summary
  webctl test snapshot --site SITE_ID --file SNAPSHOT_JSON

Locator flags:
  --role button --name Save
  --testid save-button
  --text "Save changes"
  --label Email
  --placeholder Search
  --css "button[type=submit]"
  --exact
`);
}

async function main() {
  const [a, b, c] = argv;
  if (!a || a === "help" || a === "--help" || a === "-h") return help();

  if (a === "health") return print(await client.call("health"));
  if (a === "browser" && b === "status") return print(await client.call("browser.status"));
  if (a === "browser" && b === "repair") return print(await client.call("browser.repair"));
  if (a === "browser" && b === "reveal") return print(await client.call("browser.reveal"));
  if (a === "browser" && b === "hide") return print(await client.call("browser.hide"));
  if (a === "browser" && b === "profiles") return print(await client.call("browser.profiles"));
  if (a === "browser" && b === "use") {
    // --auto clears any pinned profile and goes back to "first profile, best available mode".
    const reset = boolFlag("auto");
    const mode = boolFlag("managed") ? "managed" : boolFlag("real") ? "real" : undefined;
    const profile = flag("profile");
    const userDataDir = flag("user-data-dir");
    if (!reset && !mode && !profile && !userDataDir) {
      throw new Error("Usage: webctl browser use (--profile NAME | --auto | --managed | --real | --user-data-dir DIR)");
    }
    return print(await client.call("browser.use", {
      reset, mode, profile, userDataDir, profileDirectory: flag("profile-directory"),
    }));
  }

  if (a === "session" && b === "open") return print(await client.call("session.open", { url: flag("url") }));
  if (a === "session" && b === "list") return print(await client.call("session.list"));
  if (a === "session" && b === "close" && boolFlag("all")) return print(await client.call("session.closeAll"));
  if (a === "session" && b === "close") return print(await client.call("session.close", { sessionId: required("session") }));

  if (a === "snapshot") return print(await client.call("page.snapshot", { sessionId: required("session"), save: boolFlag("save"), query: flag("query") }));
  if (a === "screenshot") return print(await client.call("page.screenshot", { sessionId: required("session"), fullPage: boolFlag("full-page") }));
  if (a === "network" && b === "start") return print(await client.call("network.start", { sessionId: required("session") }));
  if (a === "network" && b === "stop") return print(await client.call("network.stop", { sessionId: required("session") }));
  if (a === "goto") return print(await client.call("page.goto", { sessionId: required("session"), url: required("url"), observe: boolFlag("observe") }));
  if (a === "click") return print(await client.call("page.click", { sessionId: required("session"), locator: locatorFromFlags(), confirmed: boolFlag("confirm"), force: boolFlag("force"), observe: boolFlag("observe") }));
  if (a === "fill") return print(await client.call("page.fill", { sessionId: required("session"), locator: locatorFromFlags(), value: required("value"), observe: boolFlag("observe") }));
  if (a === "press") {
    const hasLocator = ["role", "testid", "text", "label", "placeholder", "css"].some((x) => flag(x));
    return print(await client.call("page.press", { sessionId: required("session"), locator: hasLocator ? locatorFromFlags() : undefined, key: required("key"), observe: boolFlag("observe") }));
  }
  if (a === "extract") return print(await client.call("page.extract", {
    sessionId: required("session"), locator: locatorFromFlags(), read: flag("read") || "text", attribute: flag("attribute")
  }));

  // Discovery tools for unknown sites
  if (a === "dismiss-annoyances") return print(await client.call("page.dismissAnnoyances", { sessionId: required("session") }));
  if (a === "forms") return print(await client.call("page.forms", { sessionId: required("session") }));
  if (a === "diff") {
    const rawBefore = required("before");
    let beforeObj: any;
    if (rawBefore.startsWith("{")) {
      beforeObj = JSON.parse(rawBefore);
    } else {
      const fsSync = await import("node:fs");
      beforeObj = JSON.parse(fsSync.readFileSync(rawBefore, "utf8"));
    }
    return print(await client.call("page.diff", { sessionId: required("session"), before: beforeObj }));
  }
  if (a === "api-sniff") return print(await client.call("page.sniffApi", { sessionId: required("session"), durationMs: flag("duration-ms") }));
  if (a === "wait-idle") return print(await client.call("page.waitForIdle", { sessionId: required("session"), timeoutMs: flag("timeout-ms") }));
  if (a === "scroll") return print(await client.call("page.scroll", {
    sessionId: required("session"),
    direction: flag("direction") || "down",
    distance: flag("distance"),
    times: flag("times"),
    selector: flag("selector"),
    delayMs: flag("delay-ms"),
  }));
  if (a === "wait-for") return print(await client.call("page.waitFor", {
    sessionId: required("session"),
    css: flag("css"),
    text: flag("text"),
    timeoutMs: flag("timeout-ms"),
    state: flag("state"),
  }));
  if (a === "eval") return print(await client.call("page.evaluate", {
    sessionId: required("session"),
    expression: required("expr"),
  }));

  if (a === "identify") return print(await client.call("site.identify", { sessionId: required("session") }));
  if (a === "actions") return print(await client.call("action.list", { sessionId: required("session") }));
  if (a === "run") {
    const actionId = b;
    if (!actionId) throw new Error("Usage: webctl run ACTION --session ID");
    const input = flag("input") ? JSON.parse(flag("input")!) : {};
    return print(await client.call("action.run", {
      sessionId: required("session"), actionId, input, confirmed: boolFlag("confirm"), siteId: flag("site")
    }));
  }

  if (a === "learning" && b === "status") return print(await client.call("learning.status", { sessionId: required("session") }));
  if (a === "registry" && b === "build") return print(await buildRegistry(config));
  if (a === "site" && b === "init") {
    let host = flag("host");
    if (!host && flag("session")) {
      const snap: any = await client.call("page.snapshot", { sessionId: flag("session"), save: false });
      host = new URL(snap.snapshot.url).hostname;
    }
    if (!host) throw new Error("site init requires --host or --session");
    return print(await initSite(config, required("id"), host, flag("name")));
  }
  if (a === "site" && b === "validate") return print(await validateSites(config, flag("id")));
  if (a === "metrics" && b === "summary") return print(await metricsSummary(config));
  if (a === "baseline" && b === "record") return print(await recordBaseline(config, {
    task: required("task"), site: flag("site"), durationMs: Number(required("duration-ms")),
    llmCalls: flag("llm-calls") ? Number(flag("llm-calls")) : undefined,
    browserActions: flag("browser-actions") ? Number(flag("browser-actions")) : undefined,
    success: required("success").toLowerCase() === "true", notes: flag("notes")
  }));
  if (a === "baseline" && b === "summary") return print(await baselineSummary(config));

  if (a === "test" && b === "snapshot") {
    const site = await loadSite(config, required("site"));
    const snapshot = JSON.parse(await fs.readFile(required("file"), "utf8")) as PageSnapshot;
    return print({ site: site.definition.site.id, ...detectStateOffline(snapshot, site.definition) });
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
