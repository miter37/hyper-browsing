import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config";

export function tokenPath(config: AppConfig): string {
  return path.join(config.runtimeDir, "browserd.token");
}

export async function ensureToken(config: AppConfig): Promise<string> {
  const file = tokenPath(config);
  try {
    const value = (await fs.readFile(file, "utf8")).trim();
    if (value) {
      if (process.platform !== "win32") await fs.chmod(file, 0o600);
      return value;
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  const value = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(file, value + "\n", { encoding: "utf8", mode: 0o600 });
  return value;
}

export async function readToken(config: AppConfig): Promise<string> {
  return (await fs.readFile(tokenPath(config), "utf8")).trim();
}
