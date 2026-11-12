import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * npm/npx may run from a cache. Keep browser profiles and learned site assets
 * outside that cache. Git-clone users can continue to use the original launcher
 * and its repository-local workspace unchanged.
 */
export function prepareWorkspace(packageRoot, env = process.env) {
  const workspace = path.resolve(env.WEBAGENT_WORKSPACE_DIR || path.join(os.homedir(), ".hyper-browsing"));
  const runtimeDir = path.resolve(env.WEBAGENT_RUNTIME_DIR || path.join(workspace, "runtime"));
  const sitesDir = path.resolve(env.WEBAGENT_SITES_DIR || path.join(workspace, "sites"));
  const generatedDir = path.resolve(env.WEBAGENT_GENERATED_DIR || path.join(workspace, "generated"));
  const root = path.resolve(packageRoot);

  env.WEBAGENT_HOME ||= root;
  env.WEBAGENT_RUNTIME_DIR = runtimeDir;
  env.WEBAGENT_SITES_DIR = sitesDir;
  env.WEBAGENT_GENERATED_DIR = generatedDir;

  for (const dir of [workspace, runtimeDir, sitesDir, generatedDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (process.platform !== "win32") {
    fs.chmodSync(workspace, 0o700);
    fs.chmodSync(runtimeDir, 0o700);
  }

  // Preserve every user edit. Package upgrades only add missing built-in assets.
  const shippedSites = path.join(root, "sites");
  if (fs.existsSync(shippedSites) && shippedSites !== sitesDir) {
    for (const entry of fs.readdirSync(shippedSites, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      fs.cpSync(path.join(shippedSites, entry.name), path.join(sitesDir, entry.name), {
        recursive: true,
        force: false,
        errorOnExist: false,
        filter: (file) => !file.split(path.sep).some((part) => part === "outputs" || part === ".runtime")
      });
    }
  }

  // A site runner under the persistent site tree may need sibling scripts,
  // node_modules and type-only SDK imports. Link those to the installed package.
  const links = [];
  for (const name of ["src", "scripts", "node_modules", "templates"]) {
    const target = path.join(root, name);
    const link = path.join(workspace, name);
    if (!fs.existsSync(target)) continue;
    try {
      let old;
      try { old = fs.lstatSync(link); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (old?.isSymbolicLink()) {
        if (path.resolve(path.dirname(link), fs.readlinkSync(link)) === target) continue;
        fs.unlinkSync(link);
      } else if (old) {
        continue; // Never replace user-managed files or directories.
      }
      fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
      links.push(link);
    } catch {
      // Link creation is optional (restricted Windows accounts may disallow it).
      // The daemon, declarative actions and MCP continue to work.
    }
  }
  return { workspace, runtimeDir, sitesDir, generatedDir, linked: links.length };
}
