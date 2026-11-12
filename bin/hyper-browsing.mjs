#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareWorkspace } from "../scripts/workspace.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function usage() {
  return [
    "Hyper-Browsing " + pkg.version + " — local-first Chrome automation for AI agents",
    "",
    "Usage:",
    "  hyper-browsing mcp               Start the local MCP stdio server",
    "  hyper-browsing init              Create a persistent local workspace",
    "  hyper-browsing doctor            Check browser connection and daemon health",
    "  hyper-browsing webctl <command>  Run existing webctl commands",
    "  hyper-browsing browserd          Run browser daemon in foreground",
    "  hyper-browsing --version",
    "  hyper-browsing --help",
    "",
    "The MCP transport uses stdout exclusively for JSON-RPC; logs go to stderr.",
    "A Chrome installation is required for real browsing. No hosted browser service.",
    "For install/configuration help: https://github.com/miter37/hyper-browsing"
  ].join("\n");
}

function launch(target, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "launcher.mjs"), target, ...args], {
      cwd: ROOT, env: process.env, stdio: "inherit", windowsHide: true
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) return reject(new Error("Process ended with signal " + signal));
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ["-h", "--help", "help"].includes(command)) {
    process.stdout.write(usage() + "\n");
    return;
  }
  if (["-v", "--version", "version"].includes(command)) {
    process.stdout.write(pkg.version + "\n");
    return;
  }

  const paths = prepareWorkspace(ROOT);
  if (command === "init") {
    process.stdout.write(JSON.stringify({ ok: true, message: "Local workspace ready", ...paths }, null, 2) + "\n");
    return;
  }
  if (command === "mcp") {
    if (args.length) throw new Error("mcp does not accept positional arguments");
    const { serveMcp } = await import("../mcp/server.mjs");
    await serveMcp({ root: ROOT, runtimeDir: paths.runtimeDir });
    return;
  }

  const direct = command === "webctl";
  const target = command === "browserd" ? "browserd" : "webctl";
  const rest = command === "doctor" ? ["browser", "status"] : direct || command === "browserd" ? args : [command, ...args];
  const code = await launch(target, rest);
  process.exitCode = code;
}

main().catch((error) => {
  process.stderr.write("[hyper-browsing] " + String(error?.message || error) + "\n");
  process.exitCode = 1;
});
