import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config";

export async function ensureRuntime(config: AppConfig): Promise<void> {
  for (const dir of [
    config.runtimeDir,
    path.join(config.runtimeDir, "metrics"),
    path.join(config.runtimeDir, "snapshots"),
    path.join(config.runtimeDir, "observations"),
    path.join(config.runtimeDir, "traces"),
    path.join(config.runtimeDir, "sessions"),
    config.profileDir,
  ]) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Existing runtimes created with an ordinary umask may have permissive modes.
  if (process.platform !== "win32") {
    await fs.chmod(config.runtimeDir, 0o700);
    await fs.chmod(config.profileDir, 0o700);
  }
}
