import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "hyper-browsing.mjs");
function run(args, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true, timeout: 15000
  });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r.stdout;
}
test("CLI exposes help/version without starting the daemon", () => {
  assert.match(run(["--help"]), /hyper-browsing mcp/);
  const pkg = JSON.parse(fsSync.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(run(["--version"]).trim(), pkg.version);
  assert.equal(pkg.bin["hyper-browsing"], "bin/hyper-browsing.mjs");
  assert.equal(pkg.private, undefined);
  assert.equal(typeof pkg.dependencies.tsx, "string");
});
test("npx-style invocation saves site assets in a persistent workspace", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hb-cli-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const env = { WEBAGENT_WORKSPACE_DIR: dir };
  const first = JSON.parse(run(["init"], env));
  assert.equal(first.ok, true);
  assert.ok(first.sitesDir.startsWith(dir));
  const site = path.join(first.sitesDir, "airbnb", "SKILL.md");
  assert.ok((await fs.stat(site)).isFile());
  const custom = path.join(first.sitesDir, "airbnb", "local-note.txt");
  await fs.writeFile(custom, "PRESERVE ME");
  const second = JSON.parse(run(["init"], env));
  assert.equal(second.sitesDir, first.sitesDir);
  assert.equal(await fs.readFile(custom, "utf8"), "PRESERVE ME");
  assert.ok((await fs.stat(first.runtimeDir)).isDirectory());
});

test("npm pack dry-run includes a working CLI and excludes benchmarks and runtime profiles", () => {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(command, ["pack", "--dry-run", "--json"], {
    cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 60000
  });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  const pack = JSON.parse(r.stdout)[0];
  const names = new Set(pack.files.map(x => x.path));
  for (const name of ["package.json", "bin/hyper-browsing.mjs", "mcp/server.mjs", "mcp/catalog.mjs", "scripts/launcher.mjs", "src/bin/browserd.ts", "sites/airbnb/site.yaml"]) {
    assert.ok(names.has(name), "missing " + name);
  }
  assert.ok(![...names].some(x => x.startsWith("benchmarks/") || x.startsWith(".runtime/") || x.startsWith("tests/")));
});
