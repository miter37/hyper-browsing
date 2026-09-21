#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FALLBACK_CODE = 42;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(process.env.WEBAGENT_RUNTIME_DIR || path.join(ROOT, ".runtime"));
const ENDPOINT_FILE = path.join(RUNTIME_DIR, "browserd-endpoint.json");
const TOKEN_FILE = path.join(RUNTIME_DIR, "browserd.token");

function getEndpointAndToken() {
  try {
    if (!fs.existsSync(ENDPOINT_FILE) || !fs.existsSync(TOKEN_FILE)) return null;
    const endpoint = JSON.parse(fs.readFileSync(ENDPOINT_FILE, "utf8"));
    const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (!endpoint?.port || !token) return null;
    return { port: Number(endpoint.port), token };
  } catch {
    return null;
  }
}

function parseArgs(args) {
  const flags = {};
  const boolFlags = new Set();
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        boolFlags.add(key);
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags, boolFlags };
}

function parseLocator(flags, boolFlags) {
  const exact = boolFlags.has("exact");
  if (flags.role || flags.name) return { role: flags.role, name: flags.name, exact };
  if (flags.testid) return { testid: flags.testid, exact };
  if (flags.text) return { text: flags.text, exact };
  if (flags.label) return { label: flags.label, exact };
  if (flags.placeholder) return { placeholder: flags.placeholder, exact };
  if (flags.css) return { css: flags.css, exact };
  return undefined;
}

function mapCommandToRpc(positionals, flags, boolFlags) {
  const [a, b] = positionals;

  if (a === "health") return { method: "health", params: {} };
  if (a === "browser" && b === "status") return { method: "browser.status", params: {} };

  if (a === "session" && b === "open") return { method: "session.open", params: { url: flags.url } };
  if (a === "session" && b === "list") return { method: "session.list", params: {} };
  if (a === "session" && b === "close") {
    if (boolFlags.has("all")) return { method: "session.closeAll", params: {} };
    if (flags.session) return { method: "session.close", params: { sessionId: flags.session } };
  }

  if (a === "snapshot" && flags.session) {
    return { method: "page.snapshot", params: { sessionId: flags.session, save: boolFlags.has("save"), query: flags.query } };
  }

  if (a === "screenshot" && flags.session) {
    return { method: "page.screenshot", params: { sessionId: flags.session, fullPage: boolFlags.has("full-page") } };
  }

  if (a === "goto" && flags.session && flags.url) {
    return { method: "page.goto", params: { sessionId: flags.session, url: flags.url, observe: boolFlags.has("observe") } };
  }

  if (a === "click" && flags.session) {
    return {
      method: "page.click",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        confirmed: boolFlags.has("confirm"),
        force: boolFlags.has("force"),
        observe: boolFlags.has("observe"),
      },
    };
  }

  if (a === "fill" && flags.session && flags.value !== undefined) {
    return {
      method: "page.fill",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        value: flags.value,
        observe: boolFlags.has("observe"),
      },
    };
  }

  if (a === "press" && flags.session && flags.key) {
    return {
      method: "page.press",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        key: flags.key,
        observe: boolFlags.has("observe"),
      },
    };
  }

  if (a === "extract" && flags.session) {
    return {
      method: "page.extract",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        read: flags.read || "text",
        attribute: flags.attribute,
      },
    };
  }

  if (a === "snapshot" && flags.session) {
    return { method: "page.snapshot", params: { sessionId: flags.session, save: boolFlags.has("save"), query: flags.query } };
  }

  if (a === "dismiss-annoyances" && flags.session) {
    return { method: "page.dismissAnnoyances", params: { sessionId: flags.session } };
  }

  if (a === "wait-idle" && flags.session) {
    return { method: "page.waitIdle", params: { sessionId: flags.session, timeoutMs: flags["timeout-ms"] ? Number(flags["timeout-ms"]) : undefined } };
  }

  if (a === "scroll" && flags.session) {
    return {
      method: "page.scroll",
      params: {
        sessionId: flags.session,
        direction: flags.direction || "down",
        distance: flags.distance ? Number(flags.distance) : undefined,
        times: flags.times ? Number(flags.times) : undefined,
        selector: flags.selector,
        delayMs: flags["delay-ms"] ? Number(flags["delay-ms"]) : undefined,
      },
    };
  }

  if (a === "wait-for" && flags.session) {
    return {
      method: "page.waitFor",
      params: {
        sessionId: flags.session,
        css: flags.css,
        text: flags.text,
        timeoutMs: flags["timeout-ms"] ? Number(flags["timeout-ms"]) : undefined,
        state: flags.state,
      },
    };
  }

  if (a === "eval" && flags.session && flags.expr) {
    return {
      method: "page.evaluate",
      params: {
        sessionId: flags.session,
        expression: flags.expr,
      },
    };
  }

  if (a === "learning" && b === "status" && flags.session) {
    return { method: "learning.status", params: { sessionId: flags.session } };
  }

  // Not a fast-path RPC command
  return null;
}

async function main() {
  const creds = getEndpointAndToken();
  if (!creds) process.exit(FALLBACK_CODE);

  const { positionals, flags, boolFlags } = parseArgs(process.argv.slice(2));
  const rpc = mapCommandToRpc(positionals, flags, boolFlags);
  if (!rpc) process.exit(FALLBACK_CODE);

  let requestStarted = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);

  try {
    requestStarted = true;
    const res = await fetch(`http://127.0.0.1:${creds.port}/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify(rpc),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const body = await res.json();
    if (!res.ok || (body && body.ok === false)) {
      process.stdout.write(JSON.stringify(body, null, 2) + "\n");
      process.exit(1);
    }

    const output = body.result !== undefined ? body.result : body;
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    process.exit(0);
  } catch (err) {
    clearTimeout(timer);
    // Write-duplication guard: If the request was in flight, do NOT blindly fallback to launcher
    if (requestStarted && err.name !== "AbortError" && !err.cause?.code?.includes("ECONNREFUSED")) {
      process.stderr.write(JSON.stringify({ ok: false, error: "Fast RPC failed after request transmission: " + err.message }, null, 2) + "\n");
      process.exit(1);
    }
    // Daemon unreachable before send -> fallback to launcher
    process.exit(FALLBACK_CODE);
  }
}

main();
