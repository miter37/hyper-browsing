import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { Page } from "playwright";
import type { AppConfig } from "../config";
import { ActionSchema, ElementSchema, ExtractorSchema, ConditionSchema, SiteSchema } from "../schema/site";
import { ensureLearningSite, learningContext, type LearningJournal } from "./learning";
import { claimAsset, readJson, recordLearningMetric, safeSession, serial, writeTextAtomic } from "./learning-policy";
import { loadSite } from "../engine/site-loader";
import { actionRevision, assetStatus } from "../engine/asset-state";
import { buildRegistry } from "../registry/build";
import { runKnownAction } from "../engine/action-runner";

const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const SaveActionSchema = z.object({
  id, capability: z.string().min(1).max(100), scope: z.string().min(1).max(500),
  action: ActionSchema,
  elements: z.record(id, ElementSchema).default({}),
  extractors: z.record(id, ExtractorSchema).default({}),
  preconditions: z.record(id, ConditionSchema).default({}),
  urlTemplates: z.record(id, z.string()).default({}),
  requested: z.boolean().default(false),
  validationInput: z.record(z.string(), z.unknown()).optional(),
}).strict();
function sameLocator(a: any, b: any) {
  const normalize = (v: any) => Object.fromEntries(Object.entries(v || {}).filter(([k, value]) => value !== undefined && !(k === "exact" && value === false)).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export async function observedJournal(c: AppConfig, sessionId: string): Promise<LearningJournal> {
  const file = path.join(c.runtimeDir, "observations", `learning-${safeSession(sessionId)}.json`);
  const journal = await readJson<LearningJournal | null>(file, null);
  if (!journal) throw new Error("Observe the page and execute the task before encoding knowledge");
  return journal;
}

export async function saveObservedAction(c: AppConfig, page: Page, sessionId: string, input: unknown) {
  const started = Date.now();
  const spec = SaveActionSchema.parse(input);
  const context = await learningContext(c, page, sessionId);
  if (!context) throw new Error("Cannot save non-HTTP page knowledge");
  const journal = await observedJournal(c, sessionId);
  const events = journal.events.filter(e => { try { return new URL(e.url).hostname === context.host; } catch { return false; } });
  if (!events.length) throw new Error("No structural evidence for this site");
  // Saving is not a generator: the caller provides the observed procedure, engine checks its evidence.
  const action = spec.action;
  if (action.implementation.kind === "declarative") {
    const targetElements = { ...spec.elements };
    const known = await loadSite(c, context.siteId).catch(() => null);
    Object.assign(targetElements, { ...known?.definition.elements, ...targetElements });
    for (const step of action.implementation.steps) {
      if (step.op === "wait_for") continue;
      const kind = step.op === "select" ? "fill" : step.op;
      const strategies = "element" in step && step.element ? targetElements[step.element]?.strategies || [] : [];
      const seen = events.some(e => e.kind === kind && (!strategies.length || strategies.some(s => sameLocator(s, e.details?.locator))));
      if (!seen) throw new Error(`No observed evidence for step ${step.op}; discover and verify first`);
    }
    if (!action.implementation.steps.length && action.returns?.extractor) {
      const ex = spec.extractors[action.returns.extractor] || known?.definition.extractors[action.returns.extractor];
      const strategies = ex ? targetElements[ex.element]?.strategies || [] : [];
      if (!events.some(e => e.kind === "extract" && strategies.some(s => sameLocator(s, e.details?.locator)))) {
        throw new Error("Read action requires an observed extraction of the same target");
      }
    }
  } else {
    if (!events.some(e => ["click", "fill", "press", "extract"].includes(e.kind))) throw new Error("Code action requires successful discovery interactions");
  }
  const existing = await loadSite(c, context.siteId).catch(() => null);
  const oldAction = existing?.definition.actions[spec.id];
  const oldRevision = oldAction && existing ? await actionRevision(existing, spec.id) : undefined;
  const recovery = oldRevision ? await assetStatus(c, context.siteId, spec.id, oldRevision) : null;
  await claimAsset(c, sessionId, context.key, "action", { requested: spec.requested, repair: recovery?.repairNeeded });
  const { siteId } = await ensureLearningSite(c, page, sessionId);
  const loaded = await loadSite(c, siteId);
  const saved = await serial(loaded.yamlPath, async () => {
    const doc = YAML.parse(await fs.readFile(loaded.yamlPath, "utf8"));
    // Existing shared definitions are immutable here: repair with a new named definition instead.
    for (const bucket of ["elements", "extractors", "preconditions", "urlTemplates"] as const) {
      doc[bucket] ||= {};
      for (const [key, value] of Object.entries(spec[bucket])) {
        if (doc[bucket][key] && JSON.stringify(doc[bucket][key]) !== JSON.stringify(value)) throw new Error(`Shared ${bucket}.${key} would change; use a new name to preserve other actions`);
        doc[bucket][key] = value;
      }
    }
    doc.actions ||= {};
    doc.actions[spec.id] = { ...action, lifecycle: "encoded", knowledge: { capability: spec.capability, scope: spec.scope } };
    const parsed = SiteSchema.parse(doc);
    assertReferences(parsed, spec.id);
    if (action.implementation.kind === "code") {
      await (await import("../security/action-scan")).scanActionFile(path.join(loaded.dir, "actions.ts"));
    }
    const text = YAML.stringify(doc);
    await writeTextAtomic(loaded.yamlPath, text);
    await buildRegistry(c);
    const refreshed = await loadSite(c, siteId);
    return { saved: true, merged: Boolean(oldAction), siteId, actionId: spec.id,
      revision: await actionRevision(refreshed, spec.id), repair: Boolean(recovery?.repairNeeded) };
  });
  // A risk label is not proof that replay cannot write. Only pure declarative extraction is auto-replayed.
  const extractionOnly = action.risk === "read" && action.implementation.kind === "declarative" && action.implementation.steps.length === 0 && Boolean(action.returns?.extractor) && !action.variants;
  const validation = spec.validationInput && extractionOnly
    ? await runKnownAction(c, page, await loadSite(c, siteId), { sessionId, actionId: spec.id, input: spec.validationInput, expectedRevision: saved.revision, validationOnly: true }) : undefined;
  await recordLearningMetric(c, { sessionId, kind: "action", siteId, actionId: spec.id, revision: saved.revision, merged: saved.merged, repair: saved.repair, durationMs: Date.now() - started, validated: validation?.ok });
  return { ...saved, validation, validationSkippedReason: spec.validationInput && !extractionOnly ? "Only pure extraction can be auto-replayed; verify this action in the next authorized real task" : undefined,
    nextStep: validation?.ok ? undefined : "Verify the saved version in a real task; manual discovery success is not script validation" };
}

function assertReferences(site: z.infer<typeof SiteSchema>, actionId: string) {
  const action = site.actions[actionId];
  const condition = (c: any) => {
    if (c.all || c.any) return (c.all || c.any).forEach(condition);
    if (c.element && !site.elements[c.element]) throw new Error(`Missing element: ${c.element}`);
    if (c.extractor && !site.extractors[c.extractor]) throw new Error(`Missing extractor: ${c.extractor}`);
    if (c.type === "fingerprint" && !site.fingerprints[c.name]) throw new Error(`Missing fingerprint: ${c.name}`);
    if (c.type === "state_is" && !site.states[c.state]) throw new Error(`Missing state: ${c.state}`);
  };
  for (const ex of Object.values(site.extractors)) if (!site.elements[ex.element]) throw new Error(`Missing extractor element: ${ex.element}`);
  for (const pc of action.preconditions || []) { if (!site.preconditions[pc]) throw new Error(`Missing precondition: ${pc}`); condition(site.preconditions[pc]); }
  for (const state of action.allowedStates || []) if (!site.states[state]) throw new Error(`Missing allowed state: ${state}`);
  if (action.returns && !site.extractors[action.returns.extractor]) throw new Error("Missing return extractor");
  for (const implementation of [action.implementation, ...Object.values(action.variants || {}).map(v => v.implementation).filter(Boolean)]) {
    if (implementation?.kind === "declarative") for (const step of implementation.steps) {
      if ("element" in step && step.element && !site.elements[step.element]) throw new Error(`Missing step element: ${step.element}`);
      if (step.op === "goto" && !site.urlTemplates[step.urlTemplate]) throw new Error("Missing URL template");
      if (step.op === "wait_for") condition(step.condition);
    }
  }
  for (const verify of [...action.verify, ...Object.values(action.variants || {}).flatMap(v => v.verify || [])]) condition(verify);
}
