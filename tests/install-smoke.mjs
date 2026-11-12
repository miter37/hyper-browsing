import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hb-npm-install-"));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    shell: command === npm && process.platform === "win32",
    windowsHide: true,
    timeout: 120000
  });
  if (result.status !== 0) throw new Error(command + " " + args.join(" ") + " failed:\n" + String(result.stderr || result.stdout || result.error));
  return result.stdout.trim();
}
try {
  // No publish operation: build a local tarball and install it like a registry artifact.
  const packed = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", temp]))[0];
  const tarball = path.join(temp, packed.filename);
  const installDir = path.join(temp, "consumer");
  fs.mkdirSync(installDir);
  run(npm, ["install", "--prefix", installDir, "--no-audit", "--no-fund", tarball]);
  const executable = path.join(installDir, "node_modules", "hyper-browsing", "bin", "hyper-browsing.mjs");
  if (!fs.existsSync(executable)) throw new Error("The installed package is missing its CLI bin.");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  if (run(process.execPath, [executable, "--version"]) !== version) throw new Error("Installed CLI returned a wrong version.");
  const workspace = path.join(temp, "workspace");
  const init = JSON.parse(run(process.execPath, [executable, "init"], {
    env: { WEBAGENT_WORKSPACE_DIR: workspace }
  }));
  if (!init.ok || !fs.existsSync(path.join(init.sitesDir, "airbnb", "site.yaml")))
    throw new Error("Installed CLI did not provision persistent sites.");
  const npmCli = run(npm, ["exec", "--prefix", installDir, "--", "hyper-browsing", "--version"]);
  if (npmCli !== version) throw new Error("npm exec could not launch the installed hyper-browsing command.");
  process.stdout.write(JSON.stringify({ ok: true, version, tarball: packed.filename,
    unpackedFiles: packed.entryCount, persistedSites: init.sitesDir }, null, 2) + "\n");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
