import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config";

export type VerificationOutcome = "APPLIED" | "NOT_APPLIED" | "UNKNOWN";

export interface MetricEvent {
  timestamp: string;
  sessionId: string;
  site: string;
  action: string;
  variant: string;
  ok: boolean;
  verified: VerificationOutcome;
  durationMs: number;
  failureClass?: string;
  error?: string;
  revision?: string;
  semanticVerified?: boolean;
}

function metricsPath(config: AppConfig): string {
  return path.join(config.runtimeDir, "metrics", "events.jsonl");
}

export async function appendMetric(config: AppConfig, event: MetricEvent): Promise<void> {
  await fs.appendFile(metricsPath(config), JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
}

export async function readMetrics(config: AppConfig): Promise<MetricEvent[]> {
  try {
    const raw = await fs.readFile(metricsPath(config), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as MetricEvent);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function evidenceFor(config: AppConfig, site: string, action: string, variant: string, revision?: string) {
  const events = (await readMetrics(config)).filter((e) => e.site === site && e.action === action && e.variant === variant && (!revision || e.revision === revision));
  const successes = events.filter((e) => e.ok && e.verified === "APPLIED" && (!revision || e.semanticVerified === true));
  const failures = events.filter((e) => !e.ok);
  const lastSuccess = successes.at(-1)?.timestamp;
  let freshness: "never" | "fresh" | "aging" | "stale" = "never";
  if (lastSuccess) {
    const age = Date.now() - Date.parse(lastSuccess);
    const days = age / 86_400_000;
    freshness = days <= 7 ? "fresh" : days <= 30 ? "aging" : "stale";
  }
  const successfulSessions = new Set(successes.map((e) => e.sessionId)).size;
  return { successes: successes.length, successfulSessions, failures: failures.length, lastSuccess, freshness };
}

export async function metricsSummary(config: AppConfig) {
  const events = await readMetrics(config);
  const map = new Map<string, any>();
  for (const e of events) {
    const key = `${e.site}::${e.action}::${e.variant}`;
    const row = map.get(key) ?? { site: e.site, action: e.action, variant: e.variant, successes: 0, failures: 0, lastSuccess: undefined };
    if (e.ok && e.verified === "APPLIED") { row.successes++; row.lastSuccess = e.timestamp; }
    else row.failures++;
    map.set(key, row);
  }
  return [...map.values()];
}
