import { z } from "zod";
import type { Page } from "playwright";
import { LocatorStrategySchema } from "../schema/site";
import { executePrimitive } from "./execute";
import { locatorFromStrategy } from "./locators";
import { DEEP_WALK_JS } from "./page-state";

const CommandSchema = z.object({
  op: z.enum(["fill", "select", "extract"]), locator: LocatorStrategySchema.optional(), ref: z.string().regex(/^@?e\d+$/).optional(),
  nth: z.number().int().nonnegative().optional(), within: z.string().optional(),
  value: z.string().optional(), option: z.string().optional(), timeoutMs: z.number().int().min(1).max(5000).optional(),
  read: z.enum(["text", "value", "attribute"]).optional(), attribute: z.string().optional(), all: z.boolean().optional(), limit: z.number().int().nonnegative().optional(),
}).strict().refine(v => Boolean(v.locator) !== Boolean(v.ref), "Use exactly one locator or reference")
  .refine(v => v.op === "fill" ? v.value !== undefined && v.option === undefined : v.op === "select" ? v.option !== undefined && v.value === undefined : true, "Provide value for fill or option for select")
  .refine(v => !v.ref || (v.nth === undefined && !v.within), "Reference cannot be scoped or indexed");
const BatchSchema = z.object({ commands: z.array(CommandSchema).min(1).max(10) }).strict();
const STRUCTURE_SCRIPT = `state => {
  ${DEEP_WALK_JS}
  const nodes=[];
  deepWalk(el => {
    if(!el.matches('input,textarea,select,button,a[href],[role],[contenteditable=true]')) return;
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    if(r.width<=0||r.height<=0||s.visibility==='hidden'||s.display==='none') return;
    if(!state.ids.has(el)) state.ids.set(el,state.next++);
    nodes.push([state.ids.get(el),el.tagName,el.getAttribute('role'),el.getAttribute('aria-label'),el.getAttribute('placeholder'),el.getAttribute('type'),el.disabled,el.getAttribute('aria-busy')]);
  });
  return JSON.stringify(nodes);
}`;

export async function runBatch(page: Page, input: unknown, onStep?: (command: any, result: any) => Promise<void>) {
  let spec;
  try { spec = BatchSchema.parse(input); }
  catch (error: any) { error.execution = "not_started"; throw error; }
  const results: Record<string, any>[] = []; const deadline = Date.now() + 30000;
  const state = await page.evaluateHandle(() => ({ ids: new WeakMap(), next: 1 }));
  const structure = () => page.evaluate(({ script, state }) => eval(`(${script})`)(state), { script: STRUCTURE_SCRIPT, state }).catch(() => null);
  const initial = await structure();
  try {
  for (let i = 0; i < spec.commands.length; i++) {
    const command = spec.commands[i];
    if (Date.now() >= deadline) return { ok: false, execution: "partial", stoppedAt: i, reason: "batch_budget", results, rollback: false };
    if (!initial || await structure() !== initial) return { ok: false, execution: "partial", stoppedAt: i, reason: "observation_required", results, rollback: false };
    if (command.op === "extract" && command.all && command.locator) {
      // Reading a list is not ambiguous: every visible match in page order, the same rule as `webctl extract --all`.
      const read = command.read || "text";
      const visible = locatorFromStrategy(page, command.locator).filter({ visible: true });
      const n = Math.min(await visible.count(), Math.max(1, Math.min(Number(command.limit) || 20, 100)));
      const values: Array<string | null> = [];
      for (let k = 0; k < n; k++) {
        const t = visible.nth(k);
        values.push(await (read === "value" ? t.inputValue({ timeout: 2000 }) : read === "attribute" ? t.getAttribute(command.attribute || "", { timeout: 2000 }) : t.innerText({ timeout: 2000 }).then((s: string) => s.trim())).catch(() => null));
      }
      results.push({ index: i, op: "extract", ok: true, execution: "completed", values, count: await visible.count() });
      continue;
    }
    const result = await executePrimitive(page, command.op, { ...command, timeoutMs: Math.min(command.timeoutMs || 5000, Math.max(1, deadline - Date.now())) });
    results.push({ index: i, op: command.op, ...result });
    if (onStep) await onStep(command, result);
    const changed = await structure() !== initial || result.effect?.urlChanged || result.effect?.page?.opened?.length || result.effect?.page?.closed?.length || result.effect?.page?.appeared?.length || result.effect?.page?.disappeared?.length;
    if (!result.ok || result.observationRequired || result.valueMatches === false || changed) return { ok: false, execution: result.execution === "outcome_unknown" ? "outcome_unknown" : "partial", stoppedAt: i,
      reason: changed ? "observation_required" : result.reason || "step_failed", results, rollback: false };
  }
  return { ok: true, execution: "completed", results, rollback: false };
  } finally { await state.dispose().catch(() => {}); }
}
