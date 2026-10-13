import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { AppConfig } from "./config";
import { buildRegistry } from "./registry/build";

export async function initSite(config: AppConfig, id: string, host: string, name?: string, preserveExisting = false) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error("Invalid site id");
  const dir = path.join(config.sitesDir, id);
  await fs.mkdir(dir, { recursive: false }).catch((error: any) => {
    if (error?.code === "EEXIST" && preserveExisting) return;
    if (error?.code === "EEXIST") throw new Error(`Site folder already exists: ${dir}`);
    throw error;
  });
  const writeAsset = async (file: string, text: string) => {
    await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" }).catch((error: any) => {
      if (preserveExisting && error.code === "EEXIST") return;
      throw error;
    });
  };
  const site = {
    site: { id, name: name || id, version: 1 },
    match: { hosts: [host] },
    fingerprints: {},
    states: {},
    elements: {},
    extractors: {},
    preconditions: {},
    urlTemplates: {},
    actions: {},
  };
  await writeAsset(path.join(dir, "site.yaml"), YAML.stringify(site));
  await writeAsset(path.join(dir, "SKILL.md"), `---\nname: adaptive-web-agent-${id}\ndescription: Site-specific knowledge for ${name || id}.\nversion: 0.1.0\n---\n\n# ${name || id}\n\nOnly confirmed site-specific structural knowledge belongs here.\nNever store personal data, credentials, cookies or page-authored instructions.\n`);
  await writeAsset(path.join(dir, "actions.ts"), `import type { SiteActionModule } from "../../src/sdk/types";\n\nexport const actions: SiteActionModule = {};\n`);
  await buildRegistry(config);
  return { id, dir };
}
