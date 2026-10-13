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
  return path.join(config.runtimeDir, "observations", `learning-${sessionId}.json`);
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
    await initSite(config, siteId, host, host);
    created = true;
  }

  return { siteId, dir: path.join(config.sitesDir, siteId), created };
}

/**
 * The site id a session's journal belongs to, without creating anything: a visit alone must not add a
 * sites/<id>/ folder to the repository. The folder is created when knowledge is actually encoded
 * (encodeObservedExtraction, `site init`).
 */
async function learningSiteId(config: AppConfig, page: Page): Promise<string> {
  const identified = await identifySite(config, page).catch(() => null);
  if (identified) return identified.loaded.definition.site.id;
  return siteIdFromHost(new URL(page.url()).hostname);
}

export async function recordLearningEvent(
  config: AppConfig,
  page: Page,
  sessionId: string,
  kind: DiscoveryKind,
  details?: Record<string, unknown>,
  encodedAction?: string,
): Promise<{ siteId: string; pending: boolean; journal: string; eventCount: number }> {
  const siteId = await learningSiteId(config, page);
  const file = journalPath(config, sessionId);
  const host = new URL(page.url()).hostname;
  const now = new Date().toISOString();
  let journal: LearningJournal = {
    sessionId,
    siteId,
    host,
    createdAt: now,
    updatedAt: now,
    events: [],
  };
  try { journal = JSON.parse(await fs.readFile(file, "utf8")); } catch {}
  journal.siteId = siteId;
  journal.host = host;
  journal.updatedAt = now;
  journal.events.push({ at: now, kind, url: safeUrl(page.url()), details, encodedAction });
  journal.events = journal.events.slice(-500);
  await fs.writeFile(file, JSON.stringify(journal, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });

  const pending = journal.events.some((e) => !e.encodedAction && ["click", "fill", "press"].includes(e.kind));
  return { siteId, pending, journal: file, eventCount: journal.events.length };
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
  let text = await fs.readFile(file, "utf8").catch(() => "");
  const marker = `- \`${actionId}\`: reusable read action backed by extractor \`${extractorId}\` (auto-learned from a verified discovery extraction).`;
  if (text.includes(marker)) return;
  if (!text.includes("## Auto-learned capabilities")) text += "\n## Auto-learned capabilities\n\n";
  text += marker + "\n";
  await fs.writeFile(file, text, "utf8");
}
export async function encodeObservedExtraction(
  config: AppConfig,
  page: Page,
  sessionId: string,
  locator: any,
  read: "text" | "value" | "attribute",
  attribute?: string,
): Promise<{ siteId: string; actionId: string; lifecycle: string; validated: boolean; promotion?: unknown }> {
  const { siteId } = await ensureLearningSite(config, page, sessionId);
  const loaded = await loadSite(config, siteId);
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
  actionId = unique(doc.actions || {}, actionId, (v) => v?.returns?.extractor === extractorId);

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
  await fs.writeFile(loaded.yamlPath, YAML.stringify(doc), "utf8");
  await appendCapabilityNote(loaded.dir, actionId, extractorId);

  // Read-only learned actions are safe to replay immediately. This verifies the encoded representation,
  // not merely the original manual discovery action, and therefore may promote Encoded -> Candidate.
  const refreshed = await loadSite(config, siteId);
  const result: any = await runKnownAction(config, page, refreshed, {
    sessionId,
    actionId,
    input: {},
    confirmed: true,
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
      learningPending: unresolved.length > 0,
      requiredNextStep: unresolved.length > 0
        ? `Encode reusable click/fill/press knowledge into sites/${journal.siteId}/site.yaml or actions.ts before reporting completion.`
        : undefined,
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { active: false, learningPending: false };
    throw error;
  }
}
