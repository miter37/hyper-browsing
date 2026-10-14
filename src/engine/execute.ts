import type { Page } from "playwright";
import { actOn, fillOrSelect, DEFAULT_ACTION_TIMEOUT_MS, type ActParams, type ActionKind } from "./interact";
import { riskFromTarget, requiresConfirmation, type Risk } from "./risk";
import { targetFor } from "../runtime/references";

export type PrimitiveParams = ActParams & { key?: string; option?: string; submit?: boolean; confirmed?: boolean; read?: string; attribute?: string };
/** Single target selection / timeout / readback contract used by direct commands, saved steps and batches. */
export async function executePrimitive(page: Page, kind: ActionKind, params: PrimitiveParams): Promise<Record<string, any>> {
  try { return await execute(page, kind, params); }
  catch (error: any) { return { ok: false, execution: "outcome_unknown", reason: "primitive_error", error: error.message }; }
}
async function execute(page: Page, kind: ActionKind, params: PrimitiveParams): Promise<Record<string, any>> {
  let risk: Risk = 'read';
  const activating = kind==='press' && /^(Enter|NumpadEnter|Space|Spacebar| )$/.test((params.key || '').split('+').at(-1) || '');
  const authorize = async (target:import('../runtime/references').ActionTarget) => {
    if(kind!=='click'&&!activating&&!params.submit)return undefined;
    risk=await riskFromTarget(target,activating||Boolean(params.submit));
    if(requiresConfirmation(risk)&&!params.confirmed)return {ok:false,confirmationRequired:true,risk,execution:'not_started'};
    return undefined;
  };
  if (kind === "fill" || kind === "select") {
    const result = await fillOrSelect(page, kind, params,authorize);
    if (result.valueMatches === false) return { ...result, ok: false, reason: "value_mismatch" };
    return result;
  }
  if (kind === "press" && !params.locator && !params.ref && !params.element) {
    const handle=(await page.evaluateHandle(()=>document.activeElement)).asElement();
    if(!handle)return {ok:false,reason:'invalid_target',execution:'not_started'};
    try {
      const result=await actOn(page,kind,params,(target,timeout)=>target.press(params.key||'',{timeout}),authorize,targetFor(handle as any));
      return {...result,risk};
    } finally { await handle.dispose().catch(()=>{}); }
  }
  const result = await actOn(page, kind, params, async (target, timeout) => {
    if (kind === "click") return target.click({ timeout, force: Boolean(params.force) });
    if (kind === "hover") return target.hover({ timeout, force: Boolean(params.force) });
    if (kind === "press") return target.press(params.key || "", { timeout });
    if (params.read === "value") return target.inputValue({ timeout });
    if (params.read === "attribute") return target.getAttribute(params.attribute || "", { timeout });
    return (await target.innerText({ timeout })).trim();
  }, authorize);
  return { ...result, risk };
}
export { DEFAULT_ACTION_TIMEOUT_MS };
