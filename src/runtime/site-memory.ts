import path from "node:path";
import type { AppConfig } from "../config";
import { readJson, writeJson, serial, safeSession, recordLearningMetric, type SiteNote } from "./learning-policy";

/**
 * Site memory: short, evidence-backed facts about a site, drafted by the engine from what actually happened in a
 * session (which URL parameters a control set, how a search is addressed, which frame holds the content, what
 * blocked the visit). Facts are saved as notes and shown again on the next visit, so a later task can go straight
 * to what worked. Typed text is never stored: a search parameter is recorded by name only.
 */

export type MemoryMode = "off" | "suggest" | "auto";
export function memoryMode(): MemoryMode {
  const v = (process.env.WEBAGENT_SITE_MEMORY || "").toLowerCase();
  return v === "off" || v === "suggest" || v === "auto" ? v : "auto";
}
export function memoryReadEnabled(): boolean { return (process.env.WEBAGENT_SITE_MEMORY_READ || "").toLowerCase() !== "off"; }

export interface MemoryStep {
  at: number;
  kind: "open" | "goto" | "click" | "fill" | "select" | "press" | "verify" | "blocked";
  host: string;
  key?: string;
  path: string;
  control?: { role?: string; name?: string; text?: string; label?: string; placeholder?: string; testId?: string; css?: string };
  frame?: string;
  frameUrl?: string;
  queryParam?: string;
  setParams?: Record<string, string>;
  keptParams?: Record<string, string>;
  verified?: Array<{ name: string; expected: string }>;
  freeParams?: string[];
  stateChange?: string;
  blocked?: { kind: string; evidence: string };
  submit?: boolean;
}
interface MemoryJournal { sessionId: string; steps: MemoryStep[] }

export interface MemoryFact { id: string; capability: string; text: string; key: string; evidence: string }

const journalFile = (c: AppConfig, sessionId: string) => path.join(c.runtimeDir, "observations", `memory-${safeSession(sessionId)}.json`);
const notesFile = (c: AppConfig) => path.join(c.runtimeDir, "learning", "notes.json");

// Text typed in this session, kept in daemon memory only, to tell which URL parameter carries a search.
const typed = new Map<string, string[]>();
export function rememberTyped(sessionId: string, value: unknown) {
  const v = String(value ?? "").trim();
  if (!v) return;
  const list = typed.get(sessionId) || [];
  list.push(v.toLowerCase());
  typed.set(sessionId, list.slice(-5));
}
export function forgetTyped(sessionId: string) { typed.delete(sessionId); }

// Parameters that identify a visit, an ad click or a tracking session rather than what the page shows.
const TRACKING = /^(utm_\w*|fbclid|gclid|msclkid|yclid|ref|ref_|referrer|sid|aid|label|srpvid|srepoch|source_impression_id|federated_search_id|search_pageview_id|ts|_|spm|pf_rd_\w+|qid|crid|sprefix|xpid|ved|ei|uact|oq|gs_lp|sclient|sca_esv|sxsrf|ac_meta|ac_position|ac_click_type|ac_langcode|ac_suggestion_list_length|acp_id|nad_\w+|hpos|hapos|sr_order|matching_block_id|all_sr_blocks|highlighted_blocks|sr_pri_blocks|ucfs|arphpl|session\w*|token|nonce|state|code|_ga|_gl)$/i;
function stableValue(v: string): boolean {
  if (!v || v.length > 40) return false;
  // Long mixed letter/digit runs are ids or tokens, not choices.
  if (/[A-Za-z]/.test(v) && /\d/.test(v) && v.length >= 16) return false;
  if (/^[0-9a-f-]{20,}$/i.test(v)) return false;
  return true;
}
function params(url: string): URLSearchParams | null { try { return new URL(url).searchParams; } catch { return null; } }
function pathOf(url: string): string { try { const u = new URL(url); return u.origin + u.pathname; } catch { return ""; } }
function hostOf(url: string): string { try { return new URL(url).hostname; } catch { return ""; } }

/** What a URL change says: which parameter carries the typed search, and which parameters the step set. */
// Names sites commonly give the search text. Recognised even when the address was opened directly.
const SEARCH_KEYS = /^(q|query|k|kw|keyword|keywords|search|search_query|searchterm|search_term|st|_nkw|ss|term|text|find_desc|wd|qry)$/i;
// A first page is where every search starts; "page=1" is not a choice anyone made.
const FIRST_PAGE = (k: string, v: string) => /^(page|p|pg|pagenum|pageno|start|offset|from)$/i.test(k) && /^[01]$/.test(v);
// Free text (spaces, non-Latin letters) is user input: kept as a {placeholder}, never as a value.
const FREE_TEXT = (v: string) => /\s|[^\x00-\x7F]/.test(v);

export function describeUrlChange(sessionId: string, before: string, after: string) {
  const a = params(after), b = params(before);
  if (!a) return {};
  const recent = typed.get(sessionId) || [];
  let queryParam: string | undefined;
  const setParams: Record<string, string> = {};
  const keptParams: Record<string, string> = {};
  const freeParams: string[] = [];
  for (const [k, v] of a) {
    if (TRACKING.test(k)) continue;
    const lv = v.toLowerCase();
    const typedHere = recent.some((t) => lv === t || lv.replace(/\+/g, " ") === t || (t.length >= 2 && lv.includes(t)));
    if (!queryParam && (typedHere || (SEARCH_KEYS.test(k) && v.trim()))) { queryParam = k; continue; }
    if (FREE_TEXT(v)) { freeParams.push(k); continue; }
    if (!stableValue(v) || FIRST_PAGE(k, v)) continue;
    if (!b || b.get(k) !== v) setParams[k] = v; else keptParams[k] = v;
  }
  return { queryParam, setParams: Object.keys(setParams).length ? setParams : undefined, keptParams: Object.keys(keptParams).length ? keptParams : undefined,
    freeParams: freeParams.length ? freeParams : undefined };
}

export async function recordMemoryStep(c: AppConfig, sessionId: string, step: Omit<MemoryStep, "at">) {
  if (c.learningDisabled || memoryMode() === "off" && !memoryReadEnabled()) return;
  const file = journalFile(c, sessionId);
  await serial(file, async () => {
    const j = await readJson<MemoryJournal>(file, { sessionId, steps: [] });
    j.steps.push({ at: Date.now(), ...step });
    j.steps = j.steps.slice(-200);
    await writeJson(file, j);
  }).catch(() => {});
}

function controlName(ctl?: MemoryStep["control"]): string | undefined {
  if (!ctl) return undefined;
  const n = ctl.name || ctl.label || ctl.text || ctl.placeholder || ctl.testId;
  if (!n) return undefined;
  return `${ctl.role ? ctl.role + " " : ""}"${String(n).slice(0, 60)}"`;
}
const fmt = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join("&");

/** Facts worth keeping from one session, each tied to the step that showed it. */
export async function draftMemory(c: AppConfig, sessionId: string): Promise<MemoryFact[]> {
  const j = await readJson<MemoryJournal>(journalFile(c, sessionId), { sessionId, steps: [] });
  const facts = new Map<string, MemoryFact>();
  const verified = new Map<string, Set<string>>();
  for (const s of j.steps) if (s.kind === "verify" && s.key) for (const v of s.verified || []) {
    const set = verified.get(s.key) || new Set<string>(); set.add(`${v.name}=${v.expected}`); verified.set(s.key, set);
  }
  const confirmed = (key: string, k: string, v: string) => verified.get(key)?.has(`${k}=${v}`);
  for (const s of j.steps) {
    const key = s.key || `host:${s.host}`;
    if (s.kind === "blocked" && s.blocked) {
      facts.set(`${key}|blocked`, { id: "blocked", key, capability: "blocked", text: `Visits were stopped by a ${s.blocked.kind} at ${s.path} ("${s.blocked.evidence.slice(0, 80)}"). Expect it again; do not try to get past it.`, evidence: "blocked page detected" });
      continue;
    }
    if (s.frame) {
      facts.set(`${key}|frame:${s.frame}`, { id: `frame:${s.frame}`, key, capability: `frame:${s.frame}`.slice(0, 100),
        text: `Content is inside the frame "${s.frame}"${s.frameUrl ? ` (${pathOf(s.frameUrl)})` : ""}: pass frame "${s.frame}" to read or act on it.`, evidence: `${s.kind} worked inside the frame` });
    }
    // The first search of the session is the search itself; later steps that keep the query add filters, which
    // the control facts below describe on their own.
    if (s.queryParam && !facts.has(`${key}|search`)) {
      const fixed = { ...(s.keptParams || {}), ...(s.setParams || {}) };
      const extra = [fmt(fixed), ...(s.freeParams || []).map((k) => `${k}={${k}}`)].filter(Boolean).join("&");
      const ok = Object.entries(fixed).some(([k, v]) => confirmed(key, k, v));
      facts.set(`${key}|search`, { id: "search", key, capability: "search",
        text: `Search results load at ${s.path}?${s.queryParam}={query}${extra ? "&" + extra : ""}`
          + (s.kind === "fill" ? " (typing in the search field and pressing Enter led here)" : s.kind === "open" || s.kind === "goto" ? " (opened directly and it loaded)" : ` (${s.kind} after typing led here)`)
          + (ok ? "; confirmed with verify." : "."), evidence: `${s.kind} led to the URL` });
      continue;
    }
    // A filter or sort applied in place (no URL change): which control, by role and name, did it.
    if (s.stateChange && !s.setParams && ["click", "select"].includes(s.kind)) {
      const name = controlName(s.control);
      if (name) {
        const id = `control:${s.stateChange}:${name}`.slice(0, 100);
        facts.set(`${key}|${id}`, { id, key, capability: id,
          text: `${name} applies a filter or sort in place on ${s.path}${s.keptParams ? `?${fmt(s.keptParams)}` : ""} (it became ${s.stateChange}; the URL does not change). Use this control${s.control?.role ? ` (role ${s.control.role})` : ""}.`,
          evidence: `${s.kind} changed the control's ${s.stateChange} state` });
      }
    }
    if (s.setParams && ["click", "select", "press", "fill"].includes(s.kind)) {
      const name = controlName(s.control);
      if (!name) continue;
      const set = fmt(s.setParams);
      const ok = Object.entries(s.setParams).some(([k, v]) => confirmed(key, k, v));
      const id = `control:${Object.keys(s.setParams).sort().join(",")}:${name}`.slice(0, 100);
      facts.set(`${key}|${id}`, { id, key, capability: id,
        text: `${name} sets ${set} on ${s.path}${s.keptParams ? ` (the URL also had ${fmt(s.keptParams)})` : ""}${ok ? "; confirmed with verify" : ""}. A URL with ${set} gives the same result.`, evidence: `${s.kind} changed the URL` });
    }
  }
  return [...facts.values()];
}

/** Saves facts as site notes (one per fact id per site), keeping at most `perSite` engine facts per site. */
export async function saveFacts(c: AppConfig, facts: MemoryFact[], source: "auto" | "agent", perSite = 12) {
  if (!facts.length) return { saved: 0 };
  return serial(notesFile(c), async () => {
    const notes = await readJson<Array<SiteNote & { source?: string; evidence?: string }>>(notesFile(c), []);
    let saved = 0;
    for (const f of facts) {
      const text = f.text.slice(0, 400);
      const i = notes.findIndex((n) => n.key === f.key && n.capability === f.capability);
      const value = { capability: f.capability, conditions: "", text, key: f.key, updatedAt: Date.now(), source, evidence: f.evidence };
      if (i >= 0) { if (notes[i].text !== text || notes[i].source !== source) saved++; notes[i] = { ...notes[i], ...value }; }
      else { notes.push(value); saved++; }
    }
    for (const key of new Set(facts.map((f) => f.key))) {
      const engine = notes.filter((n) => n.key === key && n.source === "auto").sort((a, b) => b.updatedAt - a.updatedAt);
      for (const old of engine.slice(perSite)) notes.splice(notes.indexOf(old), 1);
    }
    await writeJson(notesFile(c), notes);
    return { saved };
  });
}

export async function removeNotes(c: AppConfig, key: string, capabilities: string[]) {
  return serial(notesFile(c), async () => {
    const notes = await readJson<SiteNote[]>(notesFile(c), []);
    const kept = notes.filter((n) => !(n.key === key && capabilities.includes(n.capability)));
    await writeJson(notesFile(c), kept);
    return { removed: notes.length - kept.length };
  });
}

// One site often spans hosts (www., prod., search.): facts of a sibling host apply too.
const TWO_LEVEL = /\.(co|or|ne|go|ac|com|net|org|gov|edu)\.[a-z]{2}$/i;
export function baseDomain(host: string): string {
  const parts = host.toLowerCase().split(".");
  return parts.slice(TWO_LEVEL.test(host) ? -3 : -2).join(".");
}

/** The memory shown when a site is opened: short lines, newest first. */
export async function memoryFor(c: AppConfig, key: string, host: string, max = 10) {
  if (!memoryReadEnabled()) return undefined;
  const notes = await readJson<Array<SiteNote & { source?: string }>>(notesFile(c), []);
  const base = baseDomain(host);
  const sameSite = (k: string) => k === key || k === `host:${host}` || (k.startsWith("host:") && baseDomain(k.slice(5)) === base);
  const mine = notes.filter((n) => sameSite(n.key)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max);
  if (!mine.length) return undefined;
  return {
    notes: mine.map((n) => `[${n.capability}] ${n.text.slice(0, 300)} (${n.source === "auto" ? "observed" : "noted"} ${new Date(n.updatedAt).toISOString().slice(0, 10)})`),
    hint: "Saved knowledge from earlier visits. Use it to go straight to what worked (a URL with the listed parameters, the right control or frame), then confirm the result on the page. If it is wrong, fix it with site_memory_save.",
  };
}

/** Sections of a site's hand-written guide (sites/<id>/SKILL.md): headings for the briefing, one body on request. */
export async function siteGuide(dir: string, section?: string): Promise<{ sections: string[]; text?: string } | undefined> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => "");
  if (!raw.trim()) return undefined;
  const body = raw.replace(/^---[\s\S]*?\n---\s*/, "");
  const parts: Array<{ title: string; lines: string[] }> = [];
  for (const line of body.split(/\r?\n/)) {
    const h = /^#{2,3}\s+(.+)/.exec(line);
    if (h) parts.push({ title: h[1].trim(), lines: [] });
    else if (parts.length) parts[parts.length - 1].lines.push(line);
  }
  const sections = parts.filter((p) => p.lines.join("").trim()).map((p) => p.title.slice(0, 80));
  if (!section) return { sections: sections.slice(0, 12) };
  const hit = parts.find((p) => p.title === section) || parts.find((p) => p.title.toLowerCase().includes(section.toLowerCase()));
  return { sections, text: hit ? hit.lines.join("\n").trim().slice(0, 4000) : undefined };
}

/** At session close: draft, then save (auto) or offer (suggest). */
export async function closeMemory(c: AppConfig, sessionId: string) {
  forgetTyped(sessionId);
  const mode = memoryMode();
  if (mode === "off" || c.learningDisabled) return undefined;
  const facts = await draftMemory(c, sessionId).catch(() => [] as MemoryFact[]);
  if (!facts.length) return undefined;
  if (mode === "auto") {
    const r = await saveFacts(c, facts, "auto");
    await recordLearningMetric(c, { sessionId, kind: "site_memory", mode, facts: facts.length, saved: r.saved });
    return { saved: facts.map((f) => `[${f.capability}] ${f.text}`), note: "Saved as site memory; shown on the next visit." };
  }
  await recordLearningMetric(c, { sessionId, kind: "site_memory", mode, facts: facts.length, saved: 0 });
  return { draft: facts.map((f) => ({ id: f.id, text: f.text })), hint: "Facts observed in this session. Keep the useful ones with site_memory_save({sessionId, accept:[ids]})." };
}

export async function acceptDraft(c: AppConfig, sessionId: string, ids: string[]) {
  const facts = (await draftMemory(c, sessionId)).filter((f) => ids.includes(f.id));
  const r = await saveFacts(c, facts, "agent");
  return { accepted: facts.map((f) => f.id), saved: r.saved };
}
