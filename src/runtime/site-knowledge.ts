import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { AppConfig } from "../config";
import { SiteSchema, LocatorStrategySchema } from "../schema/site";
import { initSite } from "../site-scaffold";
import { buildRegistry } from "../registry/build";
import { serial } from "./learning-policy";
import { baseDomain } from "./site-memory";

/**
 * Site knowledge an agent writes on purpose: a guide (SKILL.md sections) and saved actions (site.yaml), for a
 * registered site or a new one. Steps may name a URL or a locator inline; they are turned into the site's URL
 * templates and elements here, so the agent writes what it did and the definition stays in the usual shape.
 */

export type AgentStep =
  | { op: "goto"; url?: string; urlTemplate?: string }
  | { op: "click" | "fill" | "select" | "press"; element?: string; locator?: Record<string, unknown>; value?: string; key?: string }
  | { op: "wait_for"; condition: unknown; timeoutMs?: number }
  | { op: "script"; source: string };

export interface AgentAction {
  description: string;
  risk?: "read" | "local_write" | "external_write" | "irreversible";
  steps: AgentStep[];
  verify?: unknown[];
  /** Input for the trial run before saving (read actions). false: save without a trial. */
  test?: Record<string, unknown> | false;
}

export interface KnowledgeInput {
  host: string;
  siteId?: string;
  name?: string;
  guide?: string;
  urlTemplates?: Record<string, string>;
  elements?: Record<string, unknown>;
  actions?: Record<string, AgentAction>;
  remove?: string[];
}

const ID = /^[a-z0-9][a-z0-9_-]*$/;

/** Folder/id for a site that has no definition yet: blog.example.co.kr -> blog_example_co_kr (www. dropped). */
export function siteIdForHost(host: string): string {
  const id = host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!ID.test(id)) throw new Error(`Cannot derive a site id from host ${host}`);
  return id;
}

/** "https://x.test/search?q={query}&page=1" -> "https://x.test/search*": the loaded address, not the exact query. */
export function urlPatternFor(template: string): string {
  const cut = template.split(/[?#]/)[0];
  const glob = cut.replace(/\{[^}]+\}/g, "*");
  return glob.endsWith("*") ? glob : glob + "*";
}

/** Merges guide sections ("## Title" + body) into an existing SKILL.md: same title replaced, new titles appended. */
export function mergeGuide(existing: string, incoming: string, title: string): string {
  const text = incoming.trim();
  if (!text) return existing;
  const withHeading = /^##\s+/m.test(text) ? text : `## Notes\n${text}`;
  const split = (md: string) => {
    const head: string[] = [];
    const sections: Array<{ title: string; lines: string[] }> = [];
    for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
      const h = /^##\s+(.+?)\s*$/.exec(line);
      if (h) sections.push({ title: h[1], lines: [line] });
      else if (sections.length) sections[sections.length - 1].lines.push(line);
      else head.push(line);
    }
    return { head, sections };
  };
  const base = split(existing.trim() ? existing : `# ${title}\n`);
  const add = split(withHeading);
  for (const s of add.sections) {
    const at = base.sections.findIndex((b) => b.title.toLowerCase() === s.title.toLowerCase());
    if (at >= 0) base.sections[at] = s; else base.sections.push(s);
  }
  const body = base.sections.map((s) => s.lines.join("\n").trim()).join("\n\n");
  return `${base.head.join("\n").trim()}\n\n${body}\n`;
}

function sameDomain(url: string, hosts: string[]) {
  try {
    const h = new URL(url).hostname;
    return hosts.some((x) => baseDomain(x.replace(/^\*\./, "")) === baseDomain(h));
  } catch { return false; }
}

/** Turns agent steps into schema steps, creating URL templates and elements for inline urls and locators. */
function normalizeAction(doc: any, id: string, action: AgentAction) {
  if (!ID.test(id)) throw new Error(`Action id "${id}" must be lowercase letters, digits, _ or -`);
  if (!action || typeof action.description !== "string" || !action.description.trim()) throw new Error(`Action ${id} needs a description (say what it does and its {inputs})`);
  if (!Array.isArray(action.steps) || !action.steps.length) throw new Error(`Action ${id} needs steps`);
  const steps: any[] = [];
  let gotoN = 0, elN = 0;
  for (const raw of action.steps as any[]) {
    if (raw.op === "goto") {
      let name = raw.urlTemplate;
      if (raw.url) {
        if (!/^https?:\/\//i.test(raw.url)) throw new Error(`Action ${id}: goto url must be http(s)`);
        if (!sameDomain(raw.url.replace(/\{[^}]+\}/g, "x"), doc.match.hosts)) throw new Error(`Action ${id}: ${raw.url} is not on this site (${doc.match.hosts.join(", ")})`);
        name = gotoN++ ? `${id}_${gotoN}` : id;
        doc.urlTemplates[name] = raw.url;
      }
      if (!name || !doc.urlTemplates[name]) throw new Error(`Action ${id}: goto needs url or a known urlTemplate`);
      steps.push({ op: "goto", urlTemplate: name });
    } else if (["click", "fill", "select", "press"].includes(raw.op)) {
      let element = raw.element;
      if (raw.locator) {
        const strategy = LocatorStrategySchema.parse(raw.locator);
        const existing = Object.entries(doc.elements).find(([, e]: any) => e.strategies?.some((s: any) => JSON.stringify(s) === JSON.stringify(strategy)));
        element = existing ? existing[0] : `${id}_${++elN}`;
        if (!existing) doc.elements[element] = { strategies: [strategy] };
      }
      if (raw.op !== "press" && (!element || !doc.elements[element])) throw new Error(`Action ${id}: ${raw.op} needs locator or a known element`);
      const step: any = { op: raw.op };
      if (element) step.element = element;
      if (raw.op === "fill" || raw.op === "select") {
        if (typeof raw.value !== "string") throw new Error(`Action ${id}: ${raw.op} needs value (use {name} for an input)`);
        step.value = raw.value;
      }
      if (raw.op === "press") step.key = raw.key || "Enter";
      steps.push(step);
    } else if (raw.op === "wait_for") {
      steps.push({ op: "wait_for", condition: raw.condition, ...(raw.timeoutMs ? { timeoutMs: raw.timeoutMs } : {}) });
    } else if (raw.op === "script") {
      if (typeof raw.source !== "string" || !raw.source.trim()) throw new Error(`Action ${id}: script needs source (the body of an async function of input)`);
      steps.push({ op: "script", source: raw.source });
    } else throw new Error(`Action ${id}: unknown step op ${raw.op}`);
  }
  const hasScript = steps.some((s) => s.op === "script");
  const firstGoto = steps.find((s) => s.op === "goto");
  // Without an explicit check: a script is checked by the data it returns; a page load by its address.
  const verify = Array.isArray(action.verify) && action.verify.length ? action.verify
    : !hasScript && firstGoto ? [{ type: "url_matches", pattern: urlPatternFor(doc.urlTemplates[firstGoto.urlTemplate]) }] : [];
  return {
    description: action.description.trim().slice(0, 300),
    risk: action.risk || "read",
    lifecycle: "candidate",
    knowledge: { capability: id, scope: `Saved by an agent on ${new Date().toISOString().slice(0, 10)}.` },
    implementation: { kind: "declarative", steps },
    verify,
  };
}

/**
 * Writes guide and actions for a site; creates the site when it has no definition yet. Returns what changed and
 * the previous site.yaml text, so a caller can roll an action back if its trial run fails.
 */
export async function saveSiteKnowledge(c: AppConfig, input: KnowledgeInput) {
  const host = input.host.toLowerCase();
  let id = input.siteId;
  let created = false;
  if (!id) {
    id = siteIdForHost(host);
    const exists = await fs.stat(path.join(c.sitesDir, id, "site.yaml")).then(() => true, () => false);
    if (!exists) { await initSite(c, id, host, input.name || host, true); created = true; }
  }
  const dir = path.join(c.sitesDir, id);
  const yamlPath = path.join(dir, "site.yaml");
  const changed: any = { actions: [] as string[], urlTemplates: [] as string[], elements: [] as string[], removed: [] as string[] };
  let previous = "";
  await serial(yamlPath, async () => {
    previous = await fs.readFile(yamlPath, "utf8");
    const doc: any = YAML.parse(previous);
    for (const k of ["elements", "urlTemplates", "actions", "extractors", "preconditions", "fingerprints", "states"]) doc[k] = doc[k] || {};
    const before = { t: new Set(Object.keys(doc.urlTemplates)), e: new Set(Object.keys(doc.elements)) };
    if (!doc.match.hosts.some((h: string) => h.toLowerCase() === host) && baseDomain(host) === baseDomain(doc.match.hosts[0])) doc.match.hosts.push(host);
    for (const [name, template] of Object.entries(input.urlTemplates || {})) {
      if (!/^https?:\/\//i.test(template) && !template.startsWith("/")) throw new Error(`URL template ${name} must be an http(s) URL or a path`);
      doc.urlTemplates[name] = template;
    }
    for (const [name, el] of Object.entries(input.elements || {})) {
      const strategies = (el as any)?.strategies || [el];
      doc.elements[name] = { strategies: strategies.map((s: unknown) => LocatorStrategySchema.parse(s)) };
    }
    for (const [actionId, action] of Object.entries(input.actions || {})) {
      doc.actions[actionId] = normalizeAction(doc, actionId, action);
      changed.actions.push(actionId);
    }
    for (const actionId of input.remove || []) if (doc.actions[actionId]) { delete doc.actions[actionId]; changed.removed.push(actionId); }
    changed.urlTemplates = Object.keys(doc.urlTemplates).filter((k) => !before.t.has(k) || input.urlTemplates?.[k]);
    changed.elements = Object.keys(doc.elements).filter((k) => !before.e.has(k) || input.elements?.[k]);
    if (input.name && created) doc.site.name = input.name;
    doc.site.version = (Number(doc.site.version) || 1) + (created ? 0 : 1);
    SiteSchema.parse(doc);
    await fs.writeFile(yamlPath, YAML.stringify(doc, { lineWidth: 0 }), "utf8");
  });
  let guideSections: string[] | undefined;
  if (input.guide?.trim()) {
    if (input.guide.length > 20000) throw new Error("guide is limited to 20000 characters");
    const file = path.join(dir, "SKILL.md");
    const existing = await fs.readFile(file, "utf8").catch(() => "");
    const merged = mergeGuide(existing, input.guide, input.name || host);
    await fs.writeFile(file, merged, "utf8");
    guideSections = [...merged.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  }
  await buildRegistry(c);
  return { site: id, dir, created, ...changed, ...(guideSections ? { guideSections } : {}), previous };
}

/** Takes actions back out of a site (a failed trial): an earlier version comes back, a new one goes. */
export async function dropActions(c: AppConfig, siteId: string, ids: string[], previousYaml = "") {
  const yamlPath = path.join(c.sitesDir, siteId, "site.yaml");
  const before: any = previousYaml ? YAML.parse(previousYaml) : {};
  await serial(yamlPath, async () => {
    const doc: any = YAML.parse(await fs.readFile(yamlPath, "utf8"));
    for (const id of ids) {
      if (before.actions?.[id]) doc.actions[id] = before.actions[id];
      else delete doc.actions?.[id];
    }
    SiteSchema.parse(doc);
    await fs.writeFile(yamlPath, YAML.stringify(doc, { lineWidth: 0 }), "utf8");
  });
}
