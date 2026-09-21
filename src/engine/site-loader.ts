import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { pathToFileURL } from "node:url";
import type { AppConfig } from "../config";
import { SiteSchema, type SiteDefinition } from "../schema/site";
import type { SiteActionModule } from "../sdk/types";
import { scanActionFile } from "../security/action-scan";

export interface LoadedSite {
  definition: SiteDefinition;
  dir: string;
  yamlPath: string;
}

interface SiteCacheEntry {
  mtimeMs: number;
  size: number;
  loaded: LoadedSite;
}

interface ActionCacheEntry {
  mtimeMs: number;
  size: number;
  module: SiteActionModule;
}

const siteCache = new Map<string, SiteCacheEntry>();
const actionCache = new Map<string, ActionCacheEntry>();

export async function loadSite(config: AppConfig, sitePathOrId: string): Promise<LoadedSite> {
  const dir = sitePathOrId.includes("/") || sitePathOrId.includes("\\")
    ? path.resolve(config.root, sitePathOrId)
    : path.join(config.sitesDir, sitePathOrId);
  const yamlPath = path.join(dir, "site.yaml");

  try {
    const stat = await fs.stat(yamlPath);
    const cached = siteCache.get(yamlPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.loaded;
    }

    const raw = await fs.readFile(yamlPath, "utf8");
    const definition = SiteSchema.parse(YAML.parse(raw));
    const loaded: LoadedSite = { definition, dir, yamlPath };
    siteCache.set(yamlPath, { mtimeMs: stat.mtimeMs, size: stat.size, loaded });
    return loaded;
  } catch (error) {
    siteCache.delete(yamlPath);
    throw error;
  }
}

export async function loadActionModule(site: LoadedSite): Promise<SiteActionModule> {
  const file = path.join(site.dir, "actions.ts");
  try {
    const stat = await fs.stat(file);
    const cached = actionCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.module;
    }

    await scanActionFile(file);
    const url = pathToFileURL(file);
    url.searchParams.set("v", String(Date.now()));
    const mod = await import(url.href);
    const actions = (mod.actions ?? mod.default ?? {}) as SiteActionModule;
    actionCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, module: actions });
    return actions;
  } catch {
    actionCache.delete(file);
    return {};
  }
}
