import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Page } from "playwright";
import type { AppConfig } from "../config";
import { captureSnapshot, type PageSnapshot } from "./snapshot";
import { learningContext } from "./learning";
import { observedJournal } from "./learning-assets";
import { claimAsset, markOverviewUpdated, readJson, recordLearningMetric, serial, writeJson } from "./learning-policy";
import { actionRevision, assetStatus, recordAssetFailure, recordAssetSuccess, revisionOf } from "../engine/asset-state";
import { loadSite } from "../engine/site-loader";
import { evidenceFor } from "./metrics";
import { classifyError } from "../engine/failure";
import { redactText } from "../utils/strings";
import { environmentFailure } from "../engine/environment";

const RouteSchema = z.object({ url: z.string().url(), label: z.string().min(1).max(100), readOnly: z.literal(true), expectedHeading: z.string().optional() }).strict();
const InputSchema = z.object({ routes: z.array(RouteSchema).max(2).default([]), requested: z.boolean().default(false) }).strict();
interface Manifest { siteId: string; key: string; root: string; expectedHeading?: string; routes: z.infer<typeof RouteSchema>[]; updatedAt: number }
const overviewPath = (c: AppConfig, siteId: string) => {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(siteId)) throw new Error("Invalid site id");
  return path.join(c.runtimeDir, "learning", "overviews", `${siteId}.json`);
};
const ASSET = "__overview__";
const writeIntent = /delete|logout|sign.?out|purchase|checkout|payment|transfer|unsubscribe|remove|destroy|submit|send|cancel|삭제|결제|탈퇴|송금|취소|로그아웃/i;
function normalizedUrl(raw: string) {
  const url = new URL(raw); url.hash = "";
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search) throw new Error("Overview routes must be HTTP(S), query-free structural URLs");
  return url.toString();
}
const overviewRevision = (m: Manifest) => revisionOf({ root: m.root, expectedHeading: m.expectedHeading, routes: m.routes });

function screen(snapshot: PageSnapshot, depth: number) {
  return { url: snapshot.url, depth, headings: snapshot.headings.slice(0, 8),
    candidates: snapshot.elements.slice(0, 40).map(e => ({ role: e.role, name: e.name || e.text || e.label || e.placeholder,
      href: e.href, disabled: e.disabled, verified: false, requiresObservation: true })),
    blocked: snapshot.blocked, truncated: snapshot.truncated };
}
async function inspect(page: Page, manifest: Manifest, onProbe?: (p: Page) => void, timeoutMs = 30000) {
  const deadline = Date.now() + Math.min(30000, Math.max(1, timeoutMs));
  let probe: Page | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    if (normalizedUrl(page.url()) !== manifest.root) return { ok: false, screens: [], failureClass: "structure", reason: "root_mismatch" };
    const root = await captureSnapshot(page, { limit: 60 });
    const screens = [screen(root, 0)];
    const environment = await environmentFailure(page);
    if (environment) return { ok: false, screens, failureClass: environment, reason: "environment_not_ready" };
    if (root.blocked) return { ok: false, screens, failureClass: "blocking", reason: "blocked" };
    if (manifest.expectedHeading && !root.headings.includes(manifest.expectedHeading)) return { ok: false, screens, failureClass: "structure", reason: "root_heading_changed" };
    const hrefs = new Set(root.elements.filter(e => e.tag === "a" && e.href).map(e => new URL(e.href!, page.url()).toString()));
    const routes = manifest.routes.slice(0, 2);
    for (const route of routes) {
      if (!hrefs.has(route.url)) return { ok: false, screens, failureClass: "structure", reason: "root_route_missing", failedRoute: route.label };
      if (!probe) { probe = await page.context().newPage(); onProbe?.(probe); }
      const response = await probe.goto(route.url, { waitUntil: "domcontentloaded", timeout: Math.min(5000, Math.max(1, deadline - Date.now())) });
      if ((response?.status() || 0) >= 400) return { ok: false, screens, failureClass: "network", reason: "route_http_error", status: response?.status() };
      if (normalizedUrl(probe.url()) !== route.url) return { ok: false, screens, failureClass: "auth", reason: "route_redirected" };
      const child = await captureSnapshot(probe, { limit: 60 });
      screens.push(screen(child, 1));
      const childEnvironment = await environmentFailure(probe);
      if (childEnvironment) return { ok: false, screens, failureClass: childEnvironment, reason: "environment_not_ready" };
      if (child.blocked) return { ok: false, screens, failureClass: "blocking", reason: "blocked" };
      if (route.expectedHeading && !child.headings.includes(route.expectedHeading)) return { ok: false, screens, failureClass: "structure", reason: "child_heading_changed", failedRoute: route.label };
    }
    return { ok: true, screens };
  };
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Overview timeout: 30-second exploration budget exhausted")), Math.max(1, deadline - Date.now()));
    })]);
  } catch (error: any) { return { ok: false, screens: [], failureClass: classifyError(error), reason: error.message }; }
  finally { if (timer) clearTimeout(timer); if (probe) await probe.close().catch(() => {}); }
}

export async function saveOverview(c: AppConfig, page: Page, sessionId: string, input: unknown, onProbe?: (p: Page) => void) {
  const started = Date.now();
  const spec = InputSchema.parse(input);
  const context = await learningContext(c, page, sessionId);
  if (!context) throw new Error("Observe an HTTP(S) page first");
  const journal = await observedJournal(c, sessionId);
  const root = normalizedUrl(page.url());
  const origin = new URL(root).origin;
  const routes = spec.routes.map(route => {
    const url = normalizedUrl(route.url);
    if (new URL(url).origin !== origin || writeIntent.test(url + " " + route.label)) throw new Error("Overview only follows confirmed same-origin read routes");
    if (!journal.events.some(e => e.kind === "goto" && e.url === url)) throw new Error("Route was not successfully observed; visit and inspect it first");
    return { ...route, url };
  });
  const file = overviewPath(c, context.siteId);
  const old = await readJson<Manifest | null>(file, null);
  const recovery = old ? await assetStatus(c, context.siteId, ASSET, overviewRevision(old)) : null;
  await claimAsset(c, sessionId, context.key, "overview", { requested: spec.requested, repair: recovery?.repairNeeded });
  const manifest: Manifest = { siteId: context.siteId, key: context.key, root, routes, updatedAt: Date.now() };
  const result = await inspect(page, manifest, onProbe);
  if (!result.ok) throw new Error(`Overview not saved: ${result.reason}`);
  manifest.expectedHeading = result.screens[0]?.headings[0];
  manifest.routes = routes.map((r, i) => ({ ...r, expectedHeading: result.screens[i + 1]?.headings[0] }));
  await serial(file, () => writeJson(file, manifest));
  // The wrapper contains no account-specific route, cookie or task input; manifest remains local.
  const dir = path.join(c.sitesDir, context.siteId, "scripts");
  await fs.mkdir(dir, { recursive: true });
  const wrapper = `import { runOverviewCli } from '../../../scripts/site-overview.mjs';\nawait runOverviewCli(${JSON.stringify(context.siteId)});\n`;
  await fs.writeFile(path.join(dir, `${context.siteId}_overview.mjs`), wrapper, "utf8");
  await markOverviewUpdated(c, context.key);
  await recordLearningMetric(c, { sessionId, kind: "overview-save", siteId: context.siteId, revision: overviewRevision(manifest), repair: Boolean(recovery?.repairNeeded), durationMs: Date.now() - started });
  return { saved: true, siteId: context.siteId, revision: overviewRevision(manifest), screens: result.screens,
    validated: false, repair: Boolean(recovery?.repairNeeded), nextStep: "Run the saved overview once to validate this version" };
}

export async function runOverview(c: AppConfig, page: Page, sessionId: string, options: { siteId: string; onProbe?: (p: Page) => void; timeoutMs?: number }) {
  const started = Date.now();
  const manifest = await readJson<Manifest | null>(overviewPath(c, options.siteId), null);
  if (!manifest) return { ok: false, screens: [], fallbackRequired: true, reason: "overview_not_found" };
  const revision = overviewRevision(manifest);
  const recovery = await assetStatus(c, options.siteId, ASSET, revision);
  if (recovery.suspended) return { ok: false, screens: [], revision, recovery, fallbackRequired: true };
  await learningContext(c, page, sessionId).catch(() => null);
  const result = await inspect(page, manifest, options.onProbe, options.timeoutMs);
  if (result.ok) await recordAssetSuccess(c, options.siteId, ASSET, revision, sessionId).catch(() => {});
  else if (result.reason !== "root_mismatch") await recordAssetFailure(c, options.siteId, ASSET, revision, result.failureClass || "unknown", sessionId).catch(() => {});
  await recordLearningMetric(c, { sessionId, kind: "overview-run", siteId: options.siteId, revision, ok: result.ok, failureClass: result.failureClass, durationMs: Date.now() - started });
  const known = await loadSite(c, options.siteId).catch(() => null);
  const actions = [];
  for (const [id, action] of Object.entries(known?.definition.actions || {})) {
    const rev = await actionRevision(known!, id);
    const state = await assetStatus(c, options.siteId, id, rev);
    const evidence = await evidenceFor(c, options.siteId, id, "_unknown", rev);
    actions.push({ id, description: redactText(action.description || ""), scope: action.knowledge?.scope,
      verified: evidence.successfulSessions >= 2 && !state.suspended, recovery: state,
      command: `webctl run ${id} --session ${sessionId} --site ${options.siteId}` });
  }
  return { ...result, revision, existingActions: actions, fallbackRequired: !result.ok,
    recovery: await assetStatus(c, options.siteId, ASSET, revision) };
}
