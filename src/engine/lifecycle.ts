import fs from "node:fs/promises";
import YAML from "yaml";
import type { AppConfig } from "../config";
import type { LoadedSite } from "./site-loader";
import { evidenceFor } from "../runtime/metrics";
import { serial, writeTextAtomic } from "../runtime/learning-policy";
import { actionRevision } from "./asset-state";
import { SiteSchema } from "../schema/site";

export type Lifecycle = "encoded" | "candidate" | "verified";

export async function promoteAfterSuccess(
  config: AppConfig,
  site: LoadedSite,
  actionId: string,
  variant: string,
  current: Lifecycle,
  variantSpecific: boolean,
  revision?: string,
): Promise<{ from: Lifecycle; to: Lifecycle; changed: boolean }> {
  const evidence = await evidenceFor(config, site.definition.site.id, actionId, variant, revision);
  const next: Lifecycle = evidence.successfulSessions >= 2 ? "verified" : evidence.successes >= 1 ? "candidate" : "encoded";
  if (next === current) return { from: current, to: current, changed: false };

  return serial(site.yamlPath, async () => {
  const raw = await fs.readFile(site.yamlPath, "utf8");
  const doc = YAML.parse(raw);
  if (revision && await actionRevision({ ...site, definition: SiteSchema.parse(doc) }, actionId) !== revision) return { from: current, to: current, changed: false };
  if (!doc.actions?.[actionId]) throw new Error(`Cannot promote missing action ${actionId}`);
  if (variantSpecific) {
    if (!doc.actions[actionId].variants?.[variant]) throw new Error(`Cannot promote missing variant ${variant}`);
    doc.actions[actionId].variants[variant].lifecycle = next;
  } else {
    doc.actions[actionId].lifecycle = next;
  }
  await writeTextAtomic(site.yamlPath, YAML.stringify(doc));
  return { from: current, to: next, changed: true };
  });
}
