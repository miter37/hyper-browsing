import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { Page } from "playwright";
import type { AppConfig } from "../config";
import { initSite } from "../site-scaffold";
import { loadSite } from "../engine/site-loader";
import { identifySite } from "../engine/identify";
import { runKnownAction } from "../engine/action-runner";
import { SiteSchema, type LocatorStrategy } from "../schema/site";
import { claimAsset, finishLearning, migrateNotes, pruneObservations, readDecision, recordVisit, safeSession, serial, sessionPolicies, sitePolicy, writeJson, writeTextAtomic } from "./learning-policy";
import { redactText } from "../utils/strings";
import { actionRevision } from "../engine/asset-state";

export type DiscoveryKind = "snapshot" | "goto" | "click" | "fill" | "press" | "extract" | "network";

export interface LearningEvent {
  at: string;
  kind: DiscoveryKind;
  url: string;
  details?: Record<string, unknown>;
  encodedAction?: string;
}

export interface LearningJournal {
  sessionId: string;
  siteId: string;
  host: string;
  createdAt: string;
  updatedAt: string;
  events: LearningEvent[];
  key?: string;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "item";
}

function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) u.searchParams.set(key, "<redacted>");
    u.hash = "";
    return u.toString();
  } catch { return raw.slice(0, 500); }
}

export function siteIdFromHost(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 1) return slug(parts[0] || "site");
  const commonSubdomains = new Set(["www", "app", "admin", "portal", "dashboard", "secure", "m"]);
  if (parts.length >= 3 && commonSubdomains.has(parts[0])) return slug(parts[parts.length - 2]);
  return slug(parts[parts.length - 2]);
}

function journalPath(config: AppConfig, sessionId: string): string {
  return path.join(config.runtimeDir, "observations", `learning-${safeSession(sessionId)}.json`);
}

async function siteExists(config: AppConfig, siteId: string): Promise<boolean> {
  return fs.stat(path.join(config.sitesDir, siteId, "site.yaml")).then(() => true).catch(() => false);
}

export async function ensureLearningSite(config: AppConfig, page: Page, sessionId: string): Promise<{ siteId: string; dir: string; created: boolean }> {
  const host = new URL(page.url()).hostname;
  const identified = await identifySite(config, page).catch(() => null);
  if (identified) return { siteId: identified.loaded.definition.site.id, dir: identified.loaded.dir, created: false };

  let siteId = siteIdFromHost(host);
  let created = false;

  // Avoid clobbering a different site that happens to share the same second-level label.
  if (await siteExists(config, siteId)) {
    try {
      const loaded = await loadSite(config, siteId);
      if (!loaded.definition.match.hosts.includes(host) && !loaded.definition.match.hosts.includes(`*.${host}`)) {
        siteId = slug(host.replace(/\./g, "_"));
      }
    } catch {}
  }

  if (!(await siteExists(config, siteId))) {
    await initSite(config, siteId, host, host, true);
    created = true;
  }

  return { siteId, dir: path.join(config.sitesDir, siteId), created };
}

/**
 * The site id a session's journal belongs to, without creating anything: a visit alone must not add a
 * sites/<id>/ folder to the repository. The folder is created when knowledge is actually encoded
 * (encodeObservedExtraction, `site init`).
 */
export async function learningContext(config: AppConfig, page: Page, sessionId: string) {
  if (config.learningDisabled) return null;
  const url = new URL(page.url());
  if (!["https:", "http:"].includes(url.protocol)) return null;
  const identified = await identifySite(config, page).catch(() => null);
  const siteId = identified?.loaded.definition.site.id || slug(url.hostname.replace(/\./g, "_"));
  const key = identified ? `site:${siteId}` : `host:${url.hostname}`;
  await recordVisit(config, sessionId, url.hostname, key);
  if (identified) await migrateNotes(config, url.hostname, siteId);
  return { siteId, host: url.hostname, ...(await sitePolicy(config, key)) };
}

export async function recordLearningEvent(
  config: AppConfig,
  page: Page,
  sessionId: string,
  kind: DiscoveryKind,
  details?: Record<string, unknown>,
  encodedAction?: string,
): Promise<{ siteId: string; pending: boolean; journal?: string; eventCount: number; warning?: string }> {
  try {
    const context = await learningContext(config, page, sessionId);
    if (!context) return { siteId: "", pending: false, eventCount: 0 };
    const { siteId, key } = context;
    const file = journalPath(config, sessionId);
    const host = new URL(page.url()).hostname;
    const now = new Date().toISOString();
    return await serial(file, async () => {
      let journal: LearningJournal = {
        sessionId,
        siteId,
        host,
        createdAt: now,
        updatedAt: now,
        events: [],
        key,
      };
      try { journal = JSON.parse(await fs.readFile(file, "utf8")); } catch {}
      journal.siteId = siteId;
      journal.host = host;
      journal.updatedAt = now;
      journal.key = key;
      const safeDetails = details ? JSON.parse(JSON.stringify(details, (k, value) =>
        ["value", "input", "body", "response", "textContent"].includes(k) ? undefined : typeof value === "string" ? redactText(value) : value)) : undefined;
      journal.events.push({ at: now, kind, url: safeUrl(page.url()), details: safeDetails, encodedAction });
      journal.events = journal.events.slice(-500);
      await writeJson(file, journal);

      return { siteId, pending: false, journal: file, eventCount: journal.events.length };
    });
  } catch (e: any) { return { siteId: "", pending: false, eventCount: 0, warning: `Learning observation not saved: ${e.message}` }; }
}

function locatorBase(locator: any): string {
  if (locator.testId) return slug(locator.testId);
  if (locator.label) return slug(locator.label);
  if (locator.placeholder) return slug(locator.placeholder);
  if (locator.role) return slug(`${locator.role}_${locator.name || "item"}`);
  if (locator.text) return slug(locator.text);
  if (locator.css) return slug(locator.css.replace(/^[#.]/, ""));
  return "observed_value";
}

function toLocatorStrategy(locator: any): LocatorStrategy {
  const out: any = {};
  for (const key of ["role", "name", "testId", "text", "label", "placeholder", "css", "exact"]) {
    if (locator[key] !== undefined) out[key] = locator[key];
  }
  return out as LocatorStrategy;
}


async function appendCapabilityNote(siteDir: string, actionId: string, extractorId: string): Promise<void> {
  const file = path.join(siteDir, "SKILL.md");
  await serial(file, async () => {
    let text = await fs.readFile(file, "utf8").catch(() => "");
    const marker = `- \`${actionId}\`: structural read via \`${extractorId}\`; semantic result verification is required before trusted reuse.`;
    if (text.includes(marker)) return;
    if (!text.includes("## Auto-learned capabilities")) text += "\n## Auto-learned capabilities\n\n";
    text += marker + "\n";
    await writeTextAtomic(file, text);
  });
}
export async function encodeObservedExtraction(
  config: AppConfig,
  page: Page,
  sessionId: string,
  locator: any,
  read: "text" | "value" | "attribute",
  attribute?: string,
  requested = false,
): Promise<{ siteId: string; actionId: string; lifecycle: string; validated: boolean; promotion?: unknown }> {
  const context = await learningContext(config, page, sessionId);
  if (!context) throw new Error("Cannot encode a non-HTTP page");
  await claimAsset(config, sessionId, context.key, "action", { requested });
  const { siteId } = await ensureLearningSite(config, page, sessionId);
  const loaded = await loadSite(config, siteId);
  const encoded = await serial(loaded.yamlPath, async () => {
    const raw = await fs.readFile(loaded.yamlPath, "utf8");
    const doc: any = YAML.parse(raw);
    const base = locatorBase(locator);
    let elementId = base;
    let extractorId = `read_${base}`;
    let actionId = `get_${base}`;

    const unique = (bucket: Record<string, unknown>, preferred: string, same: (value: any) => boolean) => {
      if (!bucket[preferred] || same(bucket[preferred])) return preferred;
      let n = 2;
      while (bucket[`${preferred}_${n}`]) n++;
      return `${preferred}_${n}`;
    };

    const strategy = toLocatorStrategy(locator);
    elementId = unique(doc.elements || {}, elementId, (v) => JSON.stringify(v?.strategies?.[0]) === JSON.stringify(strategy));
    extractorId = unique(doc.extractors || {}, extractorId, (v) => v?.element === elementId && v?.read === read && v?.attribute === attribute);
    actionId = unique(doc.actions || {}, actionId, (v) => v?.returns?.extractor === extractorId && v.risk === "read" && v.implementation?.kind === "declarative" && !v.implementation.steps.length && !v.variants);

    doc.elements ||= {};
    doc.extractors ||= {};
    doc.actions ||= {};
    doc.elements[elementId] ||= { strategies: [strategy], description: "Auto-encoded from a successful discovery extraction." };
    doc.extractors[extractorId] ||= { element: elementId, read, ...(read === "attribute" ? { attribute } : {}) };
    doc.actions[actionId] ||= {
      description: `Read ${extractorId} learned from discovery`,
      risk: "read",
      lifecycle: "encoded",
      implementation: { kind: "declarative", steps: [] },
      returns: { extractor: extractorId },
      verify: [{ type: "extractor_exists", extractor: extractorId }],
    };

    SiteSchema.parse(doc);
    await writeTextAtomic(loaded.yamlPath, YAML.stringify(doc));
    await appendCapabilityNote(loaded.dir, actionId, extractorId);
    return { actionId, revision: await actionRevision({ ...loaded, definition: SiteSchema.parse(doc) }, actionId) };
  });
  const { actionId } = encoded;

  // Read-only learned actions are safe to replay immediately. This verifies the encoded representation,
  // not merely the original manual discovery action, and therefore may promote Encoded -> Candidate.
  const refreshed = await loadSite(config, siteId);
  const result: any = await runKnownAction(config, page, refreshed, {
    sessionId,
    actionId,
    input: {},
    expectedRevision: encoded.revision,
    validationOnly: true,
  });
  return {
    siteId,
    actionId,
    lifecycle: result.promotion?.to || result.lifecycle || "encoded",
    validated: Boolean(result.ok),
    promotion: result.promotion,
  };
}

export async function learningStatus(config: AppConfig, sessionId: string): Promise<any> {
  const file = journalPath(config, sessionId);
  try {
    const journal = JSON.parse(await fs.readFile(file, "utf8")) as LearningJournal;
    const policies = await sessionPolicies(config, sessionId);
    const unresolved = journal.events.filter((e) => !e.encodedAction && ["click", "fill", "press"].includes(e.kind));
    const encoded = journal.events.filter((e) => Boolean(e.encodedAction));
    return {
      active: true,
      siteId: journal.siteId,
      host: journal.host,
      journal: file,
      events: journal.events.length,
      encodedEvents: encoded.length,
      unresolvedEvents: unresolved.length,
      learningPending: false,
      observationsUnencoded: unresolved.length,
      decision: await readDecision(config, sessionId),
      policy: policies.find(p => p.key === journal.key || p.hosts.includes(journal.host)) || await sitePolicy(config, journal.key || `host:${journal.host}`),
      policies,
      requiredNextStep: undefined,
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      const policies = await sessionPolicies(config, sessionId);
      return { active: false, learningPending: false, decision: await readDecision(config, sessionId), policy: policies[0], policies };
    }
    throw error;
  }
}

export async function finishObservedLearning(config: AppConfig, sessionId: string) {
  if (config.learningDisabled) return { active: false, learningPending: false, learningDisabled: true };
  const existing = await readDecision(config, sessionId);
  if (!existing) await finishLearning(config, sessionId, { taskStatus: "unknown", decision: "observed_only", reason: "Session closed without additional assetization" });
  await pruneObservations(config);
  return learningStatus(config, sessionId);
}
