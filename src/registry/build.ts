import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { SiteSchema } from "../schema/site";
import type { AppConfig } from "../config";
import type { RegistryFile } from "./types";

export async function buildRegistry(config: AppConfig): Promise<RegistryFile> {
  await fs.mkdir(config.sitesDir, { recursive: true });
  await fs.mkdir(config.generatedDir, { recursive: true });
  const dirents = await fs.readdir(config.sitesDir, { withFileTypes: true });
  const entries = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith("_")) continue;
    const file = path.join(config.sitesDir, dirent.name, "site.yaml");
    try {
      const raw = await fs.readFile(file, "utf8");
      const site = SiteSchema.parse(YAML.parse(raw));
      entries.push({
        id: site.site.id,
        name: site.site.name,
        path: path.relative(config.root, path.dirname(file)),
        match: site.match,
      });
    } catch (error: any) {
      if (error?.code === "ENOENT") continue;
      process.stderr.write(`[registry] Warning: Failed to compile ${file}, skipping: ${error?.message || error}\n`);
      continue;
    }
  }

  const registry: RegistryFile = {
    generatedAt: new Date().toISOString(),
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
  };
  const target = path.join(config.generatedDir, "target_sites.json");
  await fs.writeFile(target, JSON.stringify(registry, null, 2) + "\n", "utf8");
  return registry;
}
