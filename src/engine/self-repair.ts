import fs from "node:fs/promises";
import YAML from "yaml";
import type { Page } from "playwright";
import type { AppConfig } from "../config";
import type { LoadedSite } from "./site-loader";
import { SiteSchema, type ElementDefinition, type LocatorStrategy } from "../schema/site";
import { resolveUnique } from "./locators";
import { serial, recordLearningMetric } from "../runtime/learning-policy";

/**
 * Saved site actions break when a site renames or moves a control. Repair happens in two ways:
 * - a read action whose element is not found tries looser versions of the saved strategies and the engine's
 *   own suggestions; if exactly one visible element answers and the action then verifies, the strategy that
 *   worked is written in front of the old ones (the site file gets a new revision);
 * - anything else returns what failed and what could replace it, and site_repair writes a replacement only
 *   after it resolves to exactly one visible element on the current page.
 */

/** Looser forms of a saved strategy: names matched as substrings, case-insensitive test ids. */
export function relaxedStrategies(element: ElementDefinition): LocatorStrategy[] {
  const out: LocatorStrategy[] = [];
  const push = (s: LocatorStrategy) => { if (!out.some((o) => JSON.stringify(o) === JSON.stringify(s))) out.push(s); };
  for (const s of element.strategies) {
    if (s.role && s.name) {
      push({ role: s.role, name: s.name, exact: false });
      const short = s.name.replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
      if (short && short !== s.name) push({ role: s.role, name: short, exact: false });
    }
    if (s.text) push({ text: s.text, exact: false });
    if (s.label) push({ label: s.label, exact: false });
    if (s.placeholder) push({ placeholder: s.placeholder, exact: false });
    if (s.testId) push({ css: `[data-testid*="${s.testId.replace(/["\\]/g, "")}" i]` });
  }
  return out;
}

/** One visible element that a looser strategy (or a same-named suggestion) points at, or nothing. */
export async function rescueElement(page: Page, element: ElementDefinition, failure: any, vars: Record<string, unknown> = {}): Promise<LocatorStrategy | undefined> {
  const tried: LocatorStrategy[] = [...relaxedStrategies(element)];
  const names = element.strategies.map((s) => (s.name || s.text || s.label || "").toLowerCase()).filter(Boolean);
  for (const sug of failure?.suggestions || failure?.alternatives || []) {
    const n = String(sug.name || "").toLowerCase();
    // Only a suggestion that still carries the saved name: never an unrelated control that happens to be near.
    if (sug.role && n && names.some((w) => n.includes(w) || w.includes(n))) tried.push({ role: sug.role, name: sug.name, exact: true });
  }
  for (const strategy of tried) {
    const r = await resolveUnique(page, strategy, undefined, 1200, undefined, vars).catch(() => null);
    if (r && "locator" in r) return strategy;
  }
  return undefined;
}

async function rewrite(loaded: LoadedSite, change: (doc: any) => void) {
  return serial(loaded.yamlPath, async () => {
    const raw = await fs.readFile(loaded.yamlPath, "utf8");
    const doc = YAML.parse(raw);
    change(doc);
    SiteSchema.parse(doc);
    await fs.writeFile(loaded.yamlPath, YAML.stringify(doc, { lineWidth: 0 }), "utf8");
  });
}

/** Puts a working strategy first for an element; older strategies stay as fallbacks (at most 6 kept). */
export async function saveElementStrategy(c: AppConfig, loaded: LoadedSite, elementId: string, strategy: LocatorStrategy, how: "self" | "agent", sessionId?: string) {
  await rewrite(loaded, (doc) => {
    const el = doc.elements?.[elementId];
    if (!el) throw new Error(`Unknown element: ${elementId}`);
    const same = (s: any) => JSON.stringify(s) === JSON.stringify(strategy);
    el.strategies = [strategy, ...(el.strategies || []).filter((s: any) => !same(s))].slice(0, 6);
  });
  await recordLearningMetric(c, { kind: "site_repair", how, site: loaded.definition.site.id, element: elementId, sessionId });
  return { repaired: elementId, strategy, how };
}

export async function saveUrlTemplate(c: AppConfig, loaded: LoadedSite, name: string, template: string, sessionId?: string) {
  if (!/^https?:\/\//i.test(template) && !template.startsWith("/")) throw new Error("A URL template is an http(s) URL or a path, with {name} placeholders");
  await rewrite(loaded, (doc) => {
    doc.urlTemplates = doc.urlTemplates || {};
    if (!(name in doc.urlTemplates)) throw new Error(`Unknown URL template: ${name}`);
    doc.urlTemplates[name] = template;
  });
  await recordLearningMetric(c, { kind: "site_repair", how: "agent", site: loaded.definition.site.id, urlTemplate: name, sessionId });
  return { repaired: name, template };
}

/** What to tell the caller when an element of a saved action could not be repaired automatically. */
export function repairBrief(site: string, elementId: string, element: ElementDefinition, failure: any) {
  return {
    site, element: elementId,
    savedStrategies: element.strategies.slice(0, 4),
    suggestions: (failure?.suggestions || failure?.alternatives || []).slice(0, 5),
    candidates: failure?.candidates?.slice?.(0, 5),
    howToRepair: `Finish the user's task by observing the page. Then, on the page where this control is, call site_repair with site "${site}", element "${elementId}" and a locator (or ref) of the control you used; it is saved only if it points at exactly one visible element.`,
  };
}
