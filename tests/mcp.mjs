import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "bin", "hyper-browsing.mjs");

test("native MCP stdio handshake, tool mapping, authorization and no blind RPC replay", { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hb-mcp-"));
  const runtime = path.join(dir, "runtime");
  await fs.mkdir(runtime);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/health") {
      res.statusCode = req.headers["x-browserd-token"] === "test-token" ? 200 : 401;
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url !== "/rpc" || req.headers.authorization !== "Bearer test-token") {
      res.statusCode = 401; res.end(JSON.stringify({ ok: false })); return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const packet = JSON.parse(raw);
    requests.push(packet);
    const result = packet.method === "page.click"
      ? { ok: false, execution: "not_started", confirmationRequired: true, risk: "external_write" }
      : packet.method === "request.status"
        ? { state: "unknown", execution: "outcome_unknown" }
        : { status: "ok", method: packet.method, params: packet.params };
    res.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await fs.writeFile(path.join(runtime, "browserd-endpoint.json"), JSON.stringify({ port }));
  await fs.writeFile(path.join(runtime, "browserd.token"), "test-token\n");
  const child = spawn(process.execPath, [ENTRY, "mcp"], {
    cwd: ROOT,
    env: { ...process.env, WEBAGENT_WORKSPACE_DIR: dir, WEBAGENT_RUNTIME_DIR: runtime, WEBAGENT_MCP_AUTOSTART: "0" },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true
  });
  let buffer = "", stderr = "";
  const awaiting = new Map();
  child.stderr.on("data", b => { stderr += String(b).slice(0, 2500); });
  child.stdout.on("data", b => {
    buffer += String(b);
    let pos;
    while ((pos = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, pos).trim(); buffer = buffer.slice(pos + 1);
      if (!line) continue;
      let packet;
      try { packet = JSON.parse(line); } catch (e) {
        for (const pending of awaiting.values()) pending.reject(new Error("Non-JSON on stdout: " + line + " " + stderr));
        awaiting.clear(); return;
      }
      const pending = awaiting.get(packet.id);
      if (pending) { awaiting.delete(packet.id); clearTimeout(pending.timer); pending.resolve(packet); }
    }
  });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { awaiting.delete(next); reject(new Error("Timeout waiting for " + method + ": " + stderr)); }, 10000);
    awaiting.set(next, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: next, method, params }) + "\n");
  });
  t.after(async () => {
    child.stdin.end();
    child.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  const init = await send("initialize", { protocolVersion: "2025-11-25",
    capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-11-25");
  assert.equal(init.result.serverInfo.name, "hyper-browsing");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const tools = (await send("tools/list")).result.tools;
  assert.ok(tools.length >= 20);
  for (const name of ["hb_smart_scroll", "hb_forms", "hb_dismiss_annoyances", "hb_click", "hb_verify", "hb_action_run"]) {
    assert.ok(tools.some(t => t.name === name), name);
  }
  assert.ok(!tools.some(t => t.name.includes("eval") || t.name.includes("exec")));
  const status = await send("tools/call", { name: "hb_browser_status", arguments: {} });
  assert.equal(status.result.isError, false);
  assert.equal(JSON.parse(status.result.content[0].text).method, "browser.status");
  assert.equal(requests.at(-1).method, "browser.status");

  const rejected = await send("tools/call", { name: "hb_click", arguments: { sessionId: "s" } });
  assert.equal(rejected.result.isError, true);
  assert.equal(JSON.parse(rejected.result.content[0].text).reason, "invalid_tool_arguments");

  const noApproval = await send("tools/call", { name: "hb_browser_reveal", arguments: { approved: false } });
  assert.equal(noApproval.result.isError, true);
  const invalidUrl = await send("tools/call", { name: "hb_goto", arguments: { sessionId: "s", url: "file:///etc/passwd" } });
  assert.equal(invalidUrl.result.isError, true);

  const click = await send("tools/call", { name: "hb_click", arguments: { sessionId: "s", ref: "e27" } });
  assert.equal(click.result.isError, true);
  assert.equal(JSON.parse(click.result.content[0].text).confirmationRequired, true);
  assert.equal(requests.at(-1).params.confirmed, false);

  const previousCalls = requests.length;
  const lookup = await send("tools/call", { name: "hb_request_status", arguments: { requestId: "req-123" } });
  assert.equal(JSON.parse(lookup.result.content[0].text).execution, "outcome_unknown");
  assert.equal(requests.length, previousCalls + 1);
  assert.equal(requests.at(-1).method, "request.status");
  assert.equal(requests.at(-1).params.requestId, "req-123");
  assert.ok(!stderr.includes("test-token"));
});
