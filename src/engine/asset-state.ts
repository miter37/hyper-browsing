import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AppConfig } from "../config";
import type { LoadedSite } from "./site-loader";
import { readJson, writeJson, serial } from "../runtime/learning-policy";

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(k => k !== "lifecycle" && k !== "description").map(k => [k, canonical(value[k])]));
  return value;
}
export function revisionOf(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export async function actionRevision(loaded: LoadedSite, actionId: string): Promise<string> {
  const site = loaded.definition; const action = site.actions[actionId];
  if (!action) throw new Error(`Unknown action: ${actionId}`);
  const codeAction = action.implementation.kind === "code" || Object.values(action.variants || {}).some(v => v.implementation?.kind === "code");
  const code = codeAction ? await fs.readFile(path.join(loaded.dir, "actions.ts"), "utf8").catch((e: any) => {
    if (e.code === "ENOENT") return "<missing-actions-module>";
    throw e;
  }) : undefined;
  // Code can access arbitrary named definitions. Declarative actions only hash their dependencies,
  // so adding an unrelated capability does not invalidate working actions.
  if (codeAction) return revisionOf({ action, match: site.match, elements: site.elements, extractors: site.extractors,
    fingerprints: site.fingerprints, states: site.states, preconditions: site.preconditions, urlTemplates: site.urlTemplates, code });
  const deps: Record<string, Record<string, unknown>> = { elements: {}, extractors: {}, fingerprints: {}, states: {}, preconditions: {}, urlTemplates: {} };
  const visit = (bucket: string, id: string) => {
    if (Object.hasOwn(deps[bucket], id)) return;
    const value = (site as any)[bucket][id]; deps[bucket][id] = value ?? null;
    if (value === undefined) return;
    if (bucket === "extractors") visit("elements", value.element);
    if (bucket === "fingerprints") for (const atom of [...(value.all || []), ...(value.any || [])]) {
      if (atom.element) visit("elements", atom.element);
      if (atom.fingerprint) visit("fingerprints", atom.fingerprint);
    }
    if (bucket === "states") { for (const fp of value.variants) visit("fingerprints", fp); if (value.readyWhen) condition(value.readyWhen); }
    if (bucket === "preconditions") condition(value);
  };
  const condition = (c: any) => {
    for (const child of c.all || c.any || []) condition(child);
    if (c.element) visit("elements", c.element);
    if (c.extractor) visit("extractors", c.extractor);
    if (c.type === "fingerprint") visit("fingerprints", c.name);
    if (c.type === "state_is") visit("states", c.state);
  };
  for (const fp of site.match.fingerprints || []) visit("fingerprints", fp);
  for (const state of action.allowedStates || []) visit("states", state);
  for (const pc of action.preconditions || []) visit("preconditions", pc);
  if (action.returns) visit("extractors", action.returns.extractor);
  for (const implementation of [action.implementation, ...Object.values(action.variants || {}).map(v => v.implementation).filter(Boolean)]) {
    if (implementation?.kind === "declarative") for (const step of implementation.steps) {
      if ("element" in step && step.element) visit("elements", step.element);
      if (step.op === "goto") visit("urlTemplates", step.urlTemplate);
      if (step.op === "wait_for") condition(step.condition);
    }
  }
  for (const verify of [...action.verify, ...Object.values(action.variants || {}).flatMap(v => v.verify || [])]) condition(verify);
  for (const variant of Object.keys(action.variants || {})) visit("fingerprints", variant);
  return revisionOf({ action, match: site.match, ...deps });
}
export function hasSemanticVerification(conditions: any[]): boolean {
  const semantic = (c: any): boolean => {
    if (c.all) return c.all.some(semantic);
    if (c.any) return c.any.length > 0 && c.any.every(semantic);
    return ["extractor_equals", "state_is", "url_matches", "fingerprint"].includes(c.type);
  };
  return conditions.some(semantic);
}
interface AssetRecord { site: string; asset: string; revision: string; suspended: boolean; reason?: string; at: number; sessionId: string }
const statePath = (c: AppConfig) => path.join(c.runtimeDir, "learning", "asset-state.json");
const recordKey = (site: string, asset: string, revision: string) => JSON.stringify([site, asset, revision]);
export async function assetStatus(c: AppConfig, site: string, asset: string, revision: string) {
  const states = await readJson<Record<string, AssetRecord>>(statePath(c), {});
  const current = states[recordKey(site, asset, revision)];
  const previousFailure = Object.values(states).some(v => v.site === site && v.asset === asset && v.suspended);
  return { revision, suspended: Boolean(current?.suspended), reason: current?.reason,
    validationRequired: !current && previousFailure, repairNeeded: Boolean(current?.suspended) || (!current && previousFailure),
    nextStep: current?.suspended ? "Observe the current page, complete and verify the user task, then repair the smallest broken layer. Do not replay this version." : undefined };
}
export async function recordAssetFailure(c: AppConfig, site: string, asset: string, revision: string, reason: string, sessionId: string) {
  // Timeout alone is not evidence of a changed UI. Environment problems never suspend an asset.
  if (!["locator", "verification", "wrong_result", "structure"].includes(reason)) return { suspended: false, reason };
  await serial(statePath(c), async () => {
    const states = await readJson<Record<string, AssetRecord>>(statePath(c), {});
    states[recordKey(site, asset, revision)] = { site, asset, revision, suspended: true, reason, at: Date.now(), sessionId };
    await writeJson(statePath(c), states);
  });
  return { suspended: true, reason };
}
export async function recordAssetSuccess(c: AppConfig, site: string, asset: string, revision: string, sessionId: string) {
  await serial(statePath(c), async () => {
    const states = await readJson<Record<string, AssetRecord>>(statePath(c), {});
    // Older broken revisions remain suspended; only this executed version is cleared.
    if (states[recordKey(site, asset, revision)]?.suspended) return;
    states[recordKey(site, asset, revision)] = { site, asset, revision, suspended: false, at: Date.now(), sessionId };
    await writeJson(statePath(c), states);
  });
}
