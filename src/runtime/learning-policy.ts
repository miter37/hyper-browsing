import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config";

const DAY = 86_400_000;
const locks = new Map<string, Promise<unknown>>();
export async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (e: any) { if (e.code === "ENOENT") return fallback; throw e; }
}
export async function writeJson(file: string, value: unknown): Promise<void> {
  return writeTextAtomic(file, JSON.stringify(value, null, 2) + "\n");
}
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}
export function safeSession(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) throw new Error("Invalid session id");
  return sessionId;
}
interface Visit { sessionId: string; host: string; key: string; at: number }
interface TaskBudget { at: number; asset?: string; repair?: boolean; notes: number; noteChars: number }
interface PolicyStore { visits: Visit[]; tasks: Record<string, TaskBudget>; overviews: Record<string, number> }
const empty = (): PolicyStore => ({ visits: [], tasks: {}, overviews: {} });
const storePath = (c: AppConfig) => path.join(c.runtimeDir, "learning", "policy.json");
async function update<T>(c: AppConfig, fn: (s: PolicyStore) => T, now = Date.now()): Promise<T> {
  return serial(storePath(c), async () => {
    const s = await readJson(storePath(c), empty());
    const before = JSON.stringify(s);
    s.visits = s.visits.filter(v => v.at >= now - 30 * DAY);
    for (const [id, task] of Object.entries(s.tasks)) if (task.at < now - 30 * DAY) delete s.tasks[id];
    const result = fn(s); if (JSON.stringify(s) !== before) await writeJson(storePath(c), s); return result;
  });
}
export async function recordVisit(c: AppConfig, sessionId: string, host: string, key: string, now = Date.now()) {
  safeSession(sessionId);
  return update(c, s => {
    // A host can acquire a registered site id after encoding; migrate existing visits.
    for (const v of s.visits) if (v.host === host && key.startsWith("site:")) v.key = key;
    if (key.startsWith("site:") && s.overviews[`host:${host}`]) {
      s.overviews[key] = Math.max(s.overviews[key] || 0, s.overviews[`host:${host}`]);
      delete s.overviews[`host:${host}`];
    }
    if (!s.visits.some(v => v.sessionId === sessionId && v.key === key)) s.visits.push({ sessionId, host, key, at: now });
    return { key, visits: new Set(s.visits.filter(v => v.key === key).map(v => v.sessionId)).size };
  }, now);
}
export async function sitePolicy(c: AppConfig, key: string, now = Date.now()) {
  const s = await readJson(storePath(c), empty());
  const visits = new Set(s.visits.filter(v => v.key === key && v.at >= now - 30 * DAY && v.at <= now).map(v => v.sessionId)).size;
  const lastOverviewAt = s.overviews[key];
  return { key, visits, actionEligible: visits >= 2, overviewEligible: visits >= 7,
    overviewRefreshAllowed: !lastOverviewAt || now - lastOverviewAt >= 7 * DAY, lastOverviewAt };
}
export async function sessionPolicies(c: AppConfig, sessionId: string) {
  safeSession(sessionId);
  const s = await readJson(storePath(c), empty());
  const visits = s.visits.filter(v => v.sessionId === sessionId && v.at >= Date.now() - 30 * DAY).sort((a, b) => b.at - a.at);
  const keys = [...new Set(visits.map(v => v.key))];
  return Promise.all(keys.map(async key => ({ ...(await sitePolicy(c, key)), hosts: [...new Set(visits.filter(v => v.key === key).map(v => v.host))] })));
}
export async function claimAsset(c: AppConfig, sessionId: string, key: string, kind: "action" | "overview", options: { requested?: boolean; repair?: boolean } = {}) {
  safeSession(sessionId);
  return update(c, s => {
    const task = s.tasks[sessionId] ||= { at: Date.now(), notes: 0, noteChars: 0 };
    if (!options.requested && (options.repair ? task.repair : task.asset)) throw new Error("Asset budget exhausted: finish the user task; retain observations only");
    const visits = new Set(s.visits.filter(v => v.key === key).map(v => v.sessionId)).size;
    if (!options.requested && !options.repair) {
      if (visits < (kind === "action" ? 2 : 7)) throw new Error(`Not eligible: ${kind} requires ${kind === "action" ? 2 : 7} independent tasks within 30 days`);
      if (kind === "overview" && s.overviews[key] && Date.now() - s.overviews[key] < 7 * DAY) throw new Error("Overview cooldown: at most one automatic update per 7 days");
    }
    if (options.repair) task.repair = true;
    else task.asset = kind;
    return { claimed: true, kind, repair: Boolean(options.repair) };
  });
}
export async function markOverviewUpdated(c: AppConfig, key: string) {
  await update(c, s => { s.overviews[key] = Date.now(); });
}

const NoteSchema = z.object({ capability: z.string().trim().min(1).max(100), conditions: z.string().trim().max(200), text: z.string().trim().min(1).max(600) });
export interface SiteNote { capability: string; conditions: string; text: string; key: string; updatedAt: number }
const notesPath = (c: AppConfig) => path.join(c.runtimeDir, "learning", "notes.json");
export async function saveNotes(c: AppConfig, sessionId: string, key: string, input: unknown) {
  const notes = z.array(NoteSchema).max(3).parse(input);
  const chars = notes.reduce((n, v) => n + v.text.length + v.conditions.length + v.capability.length, 0);
  if (chars > 600) throw new Error("Notes exceed 600 characters per task");
  await update(c, s => {
    const task = s.tasks[safeSession(sessionId)] ||= { at: Date.now(), notes: 0, noteChars: 0 };
    if (task.notes + notes.length > 3 || task.noteChars + chars > 600) throw new Error("Task note budget exhausted");
    task.notes += notes.length; task.noteChars += chars;
  });
  return serial(notesPath(c), async () => {
    const saved = await readJson<SiteNote[]>(notesPath(c), []);
    for (const note of notes) {
      const i = saved.findIndex(v => v.key === key && v.capability === note.capability && v.conditions === note.conditions);
      const value = { ...note, key, updatedAt: Date.now() };
      if (i < 0) saved.push(value); else saved[i] = value;
    }
    await writeJson(notesPath(c), saved);
    return { saved: notes.length };
  });
}
export async function readNotes(c: AppConfig, key: string, capability?: string) {
  return (await readJson<SiteNote[]>(notesPath(c), [])).filter(v => v.key === key && (!capability || v.capability === capability));
}
export async function migrateNotes(c: AppConfig, host: string, siteId: string) {
  await serial(notesPath(c), async () => {
    const saved = await readJson<SiteNote[]>(notesPath(c), []);
    let changed = false;
    for (const note of saved) if (note.key === `host:${host}`) { note.key = `site:${siteId}`; changed = true; }
    if (changed) await writeJson(notesPath(c), saved);
  });
}
const DecisionSchema = z.object({
  taskStatus: z.enum(["succeeded", "failed", "partial", "unknown"]),
  decision: z.enum(["saved", "merged", "skipped", "observed_only"]),
  reason: z.string().trim().min(1).max(300),
  additionalDurationMs: z.number().nonnegative().optional(),
}).strict();
export async function finishLearning(c: AppConfig, sessionId: string, input: unknown) {
  const decision = { ...DecisionSchema.parse(input), at: Date.now() };
  await writeJson(path.join(c.runtimeDir, "observations", `decision-${safeSession(sessionId)}.json`), decision);
  await recordLearningMetric(c, { sessionId, kind: "decision", taskStatus: decision.taskStatus, decision: decision.decision, additionalDurationMs: decision.additionalDurationMs });
  return decision;
}
export async function recordLearningMetric(c: AppConfig, event: Record<string, unknown>) {
  const file = path.join(c.runtimeDir, "learning", "events.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify({ at: Date.now(), ...event }) + "\n", { mode: 0o600 }).catch(() => {});
}
export async function readDecision(c: AppConfig, sessionId: string) {
  return readJson<any>(path.join(c.runtimeDir, "observations", `decision-${safeSession(sessionId)}.json`), null);
}
export async function pruneObservations(c: AppConfig, now = Date.now()) {
  const dir = path.join(c.runtimeDir, "observations");
  await serial(dir, async () => {
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const entries = [];
    for (const name of files) {
      if (!/^(learning|decision)-[\w-]+\.json$/.test(name)) continue;
      const file = path.join(dir, name); const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile()) entries.push({ file, ...stat });
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let bytes = 0;
    for (const e of entries) {
      if (e.mtimeMs < now - 30 * DAY || bytes + e.size > 10 * 1024 * 1024) await fs.unlink(e.file).catch(() => {});
      else bytes += e.size;
    }
  });
}
