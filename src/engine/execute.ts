import type { Page } from "playwright";
import { actOn, fillOrSelect, DEFAULT_ACTION_TIMEOUT_MS, type ActParams, type ActionKind } from "./interact";
import { settle } from "./page-state";
import { heuristicRiskFromText, requiresConfirmation } from "./risk";
import { referencesFor } from "../runtime/references";

export type PrimitiveParams = ActParams & { key?: string; option?: string; submit?: boolean; confirmed?: boolean; read?: string; attribute?: string };
/** Single target selection / timeout / readback contract used by direct commands, saved steps and batches. */
export async function executePrimitive(page: Page, kind: ActionKind, params: PrimitiveParams): Promise<Record<string, any>> {
  try { return await execute(page, kind, params); }
  catch (error: any) { return { ok: false, execution: "outcome_unknown", reason: "primitive_error", error: error.message }; }
}
async function execute(page: Page, kind: ActionKind, params: PrimitiveParams): Promise<Record<string, any>> {
  const metadata = params.ref ? referencesFor(page).metadata(params.ref) : undefined;
  const text = JSON.stringify(metadata ? { role: metadata.role, name: metadata.name, label: metadata.label, href: metadata.href, context: metadata.context } : params.element || params.locator || {});
  const risk = heuristicRiskFromText(text);
  if ((kind === "click" || kind === "press") && requiresConfirmation(risk) && !params.confirmed) {
    return { ok: false, confirmationRequired: true, risk, execution: "not_started" };
  }
  if (kind === "fill" || kind === "select") {
    const result = await fillOrSelect(page, kind, params);
    if (result.valueMatches === false) return { ...result, ok: false, reason: "value_mismatch" };
    return result;
  }
  if (kind === "press" && !params.locator && !params.ref && !params.element) {
    const before = page.url();
    try {
      await page.keyboard.press(params.key || ""); await settle(page, { quietMs: 300, maxMs: 1500 });
      return { ok: true, execution: "completed", effect: { urlChanged: page.url() !== before, url: page.url() } };
    } catch (error: any) { return { ok: false, execution: "outcome_unknown", reason: "keyboard_error", error: error.message }; }
  }
  const result = await actOn(page, kind, params, async (target, timeout) => {
    if (kind === "click") return target.click({ timeout, force: Boolean(params.force) });
    if (kind === "hover") return target.hover({ timeout, force: Boolean(params.force) });
    if (kind === "press") return target.press(params.key || "", { timeout });
    if (params.read === "value") return target.inputValue({ timeout });
    if (params.read === "attribute") return target.getAttribute(params.attribute || "", { timeout });
    return (await target.innerText({ timeout })).trim();
  });
  return { ...result, risk };
}
export { DEFAULT_ACTION_TIMEOUT_MS };
