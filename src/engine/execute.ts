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
    if (params.read === "section") return await target.evaluate((el: Element) => {
          const ws = /\s+/g;
          const H = "h1, h2, h3, h4, h5, h6, [role=heading]";
          const head = el.closest(H) || el.querySelector(H) || el;
          const level = /^H[1-6]$/.test(head.tagName) ? Number(head.tagName[1]) : Number(head.getAttribute("aria-level") || 2);
          // Headings are often wrapped with small extras (<div><h2>..</h2>[edit]</div>): start after the wrapper.
          let start: Element = head;
          while (start.parentElement && start.parentElement !== document.body && ((start.parentElement as HTMLElement).innerText || "").length <= ((head as HTMLElement).innerText || "").length + 40) start = start.parentElement;
          const parts: string[] = [];
          let size = 0;
          for (let n = start.nextElementSibling; n && size < 6000; n = n.nextElementSibling) {
            const h = n.matches(H) ? n : n.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role=heading]");
            if (h && (/^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : Number(h.getAttribute("aria-level") || 2)) <= level) break;
            const t = ((n as HTMLElement).innerText || "").replace(ws, " ").trim();
            if (t) { parts.push(t); size += t.length; }
          }
          return parts.join("\n");
        });
    if (params.read === "row") {
      // The row or entry that holds a label: "ISBN13" -> "ISBN13 9791163034735".
      return await target.evaluate((el: Element) => {
        const ws = /\s+/g;
        const row = el.closest("tr, [role=row], li, dl > div");
        if (row) return (row as HTMLElement).innerText.replace(ws, " ").trim();
        const term = el.closest("dt, th");
        const next = term?.nextElementSibling;
        if (term && next) return ((term as HTMLElement).innerText + " " + (next as HTMLElement).innerText).replace(ws, " ").trim();
        return ((el.parentElement || el) as HTMLElement).innerText.replace(ws, " ").trim();
      });
    }
    if (params.read === "value") return target.inputValue({ timeout });
    if (params.read === "attribute") return target.getAttribute(params.attribute || "", { timeout });
    return (await target.innerText({ timeout })).trim();
  }, authorize);
  return { ...result, risk };
}
export { DEFAULT_ACTION_TIMEOUT_MS };
