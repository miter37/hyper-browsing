import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { postRpc } from "../scripts/rpc-transport.mjs";
import { toolCatalog, toolCall } from "./catalog.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(await fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
const SUPPORTED_VERSIONS = new Set(["2026-07-28", "2025-11-25", "2025-06-18", "2024-11-05"]);
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

export function formatToolResult(result, isError = false) {
  const raw = JSON.stringify(result ?? null);
  if (raw.length <= 380_000) return {
    isError,
    content: [{ type: "text", text: raw }]
  };
  // A large read must not exhaust host context. Preserve crucial status facts,
  // especially outcome_unknown and requestId, instead of claiming a clean success.
  const summary = {
    truncated: true,
    ok: result?.ok,
    execution: result?.execution,
    requestId: result?.requestId,
    reason: result?.reason,
    confirmationRequired: result?.confirmationRequired,
    risk: result?.risk,
    hint: "Result exceeded MCP output budget. Request a narrower snapshot/query/limit.",
    preview: raw.slice(0, 280_000)
  };
  return { isError, content: [{ type: "text", text: JSON.stringify(summary) }] };
}

/** Minimal JSON-RPC 2.0 / MCP stdio transport; stdout is protocol-only. */
export async function serveMcp({ root = PACKAGE_ROOT, runtimeDir = process.env.WEBAGENT_RUNTIME_DIR } = {}) {
  const runtime = path.resolve(runtimeDir || path.join(root, ".runtime"));
  let startup;
  const send = (payload) => process.stdout.write(JSON.stringify(payload) + "\n");
  const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
  const error = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  async function available() {
    try {
      const [endpointJson, tokenText] = await Promise.all([
        fs.readFile(path.join(runtime, "browserd-endpoint.json"), "utf8"),
        fs.readFile(path.join(runtime, "browserd.token"), "utf8")
      ]);
      const endpoint = JSON.parse(endpointJson);
      const port = Number(endpoint.port);
      const token = tokenText.trim();
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !token) return null;
      const url = "http://127.0.0.1:" + port;
      const response = await fetch(url + "/health", {
        headers: { "x-browserd-token": token }, signal: AbortSignal.timeout(1300)
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.status === "ok" ? { endpoint: url, token } : null;
    } catch { return null; }
  }

  async function launchDaemon() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, "scripts", "launcher.mjs"), "webctl", "health"], {
        cwd: root,
        env: { ...process.env, WEBAGENT_HOME: root },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      let stderr = "";
      // Absolutely no child stdout must reach the MCP protocol channel.
      child.stdout.on("data", () => {});
      child.stderr.on("data", buf => {
        if (stderr.length < 8000) stderr += String(buf).slice(0, 8000 - stderr.length);
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Browser daemon startup exceeded 90 seconds; check Chrome and local permissions."));
      }, 90_000);
      child.once("error", e => { clearTimeout(timer); reject(e); });
      child.once("close", code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error("Daemon bootstrap failed (" + code + "). " + stderr.slice(-3000)));
      });
    });
  }

  async function credentials(canStart) {
    let current = await available();
    if (current) return current;
    if (!canStart || process.env.WEBAGENT_MCP_AUTOSTART === "0") {
      throw new Error("No running Hyper-Browsing daemon; request status remains unknown. Start the daemon separately.");
    }
    if (!startup) startup = launchDaemon().finally(() => { startup = undefined; });
    await startup;
    current = await available();
    if (!current) throw new Error("Daemon started but authenticated health check failed.");
    return current;
  }

  async function invoke(name, args) {
    let mapping;
    try {
      mapping = toolCall(name, args);
    } catch (e) {
      return formatToolResult({ ok: false, execution: "not_started", reason: "invalid_tool_arguments",
        error: String(e?.message || e) }, true);
    }
    try {
      const creds = await credentials(mapping.autoStart);
      const response = await postRpc({
        endpoint: creds.endpoint, token: creds.token, method: mapping.method,
        params: mapping.params
      });
      const result = response.result;
      const failed = !response.rpcOk || result?.ok === false || Boolean(result?.confirmationRequired);
      return formatToolResult(result, failed);
    } catch (e) {
      return formatToolResult({ ok: false, execution: "not_started",
        reason: "mcp_backend_unavailable", error: String(e?.message || e) }, true);
    }
  }

  async function handle(packet) {
    if (!packet || typeof packet !== "object" || Array.isArray(packet) || packet.jsonrpc !== "2.0" ||
      typeof packet.method !== "string") {
      error(packet?.id ?? null, -32600, "Invalid JSON-RPC request");
      return;
    }
    // Notifications are one-way, and must never generate protocol replies.
    if (!Object.hasOwn(packet, "id")) return;
    const id = packet.id;
    const params = packet.params && typeof packet.params === "object" && !Array.isArray(packet.params)
      ? packet.params : {};
    try {
      if (packet.method === "initialize") {
        const requested = params.protocolVersion;
        reply(id, {
          protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "hyper-browsing", version: PACKAGE.version },
          instructions: "Local Chrome automation. Prefer read-only inspection first. Do not set confirmed=true or approved=true without explicit user authorization. outcome_unknown must never be blindly repeated."
        });
      } else if (packet.method === "ping") {
        reply(id, {});
      } else if (packet.method === "tools/list") {
        reply(id, { tools: toolCatalog });
      } else if (packet.method === "tools/call") {
        if (typeof params.name !== "string" || !toolCatalog.some(t => t.name === params.name)) {
          error(id, -32602, "Unknown tool");
          return;
        }
        reply(id, await invoke(params.name, params.arguments || {}));
      } else {
        error(id, -32601, "Method not found: " + packet.method);
      }
    } catch (e) {
      error(id, -32603, String(e?.message || e));
    }
  }

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = 0;
  const working = new Set();
  await new Promise(resolve => {
    input.on("line", line => {
      if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
        error(null, -32700, "MCP message exceeds 2 MiB");
        return;
      }
      let parsed;
      try { parsed = JSON.parse(line); }
      catch { error(null, -32700, "Invalid JSON"); return; }
      const task = handle(parsed).catch(e => error(parsed?.id ?? null, -32603, String(e?.message || e)));
      working.add(task);
      task.finally(() => working.delete(task));
      pending++;
    });
    input.once("close", async () => {
      await Promise.allSettled([...working]);
      resolve();
    });
    input.once("error", e => {
      process.stderr.write("[hyper-browsing-mcp] " + String(e?.message || e) + "\n");
      input.close();
    });
  });
}

// Direct execution for development; the published CLI calls serveMcp itself.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveMcp().catch(e => {
    process.stderr.write("[hyper-browsing-mcp] " + String(e?.message || e) + "\n");
    process.exitCode = 1;
  });
}
