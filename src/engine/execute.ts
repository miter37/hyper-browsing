import type { Page } from "playwright";
import { actOn, fillOrSelect, DEFAULT_ACTION_TIMEOUT_MS, type ActParams, type ActionKind } from "./interact";
import { riskFromTarget, requiresConfirmation, type Risk } from "./risk";
import { targetFor, type ActionTarget } from "../runtime/references";

async function clickCoveredLink(target: ActionTarget, timeout: number): Promise<boolean> {
  await target.scrollIntoViewIfNeeded({timeout}).catch(()=>{});
  const point=await target.evaluate(el=>{
    if(!(el instanceof HTMLAnchorElement) || el.getAttribute('href')?.trim().startsWith('#') || !/^https?:$/.test(el.protocol) || el.hasAttribute('download'))return null;
    const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,href:el.href};
  }).catch(()=>null);
  if(!point)return false;
  const handle=await target.evaluateHandle((el,point)=>{
    if(!(el instanceof HTMLAnchorElement) || el.href!==point.href)return null;
    const root=el.getRootNode();
    const hit=(root instanceof ShadowRoot ? root : el.ownerDocument).elementFromPoint(point.x,point.y);
    const cover=hit?.closest('a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch]');
    if(!(cover instanceof HTMLAnchorElement) || cover===el || el.contains(cover) || cover.href!==point.href || cover.hasAttribute('download'))return null;
    for(let n=el.parentElement;n && !n.matches('html,body,main,[role=main]');n=n.parentElement){
      if(!n.contains(cover))continue;
      const outer=n.getBoundingClientRect(),box=cover.getBoundingClientRect();
      if(outer.width>0 && outer.height>0)return box.width<=outer.width+1 && box.height<=outer.height+1 ? cover : null;
    }
    return null;
  },point).catch(()=>undefined);
  if(!handle)return false;
  try{
    const cover=handle.asElement();if(!cover)return false;
    const carrier=targetFor(cover);
    if(await riskFromTarget(carrier)!=='read')return false;
    const [originalBox,carrierBox]=await Promise.all([target.boundingBox(),carrier.boundingBox()]);
    if(!originalBox || !carrierBox)return false;
    // Keep the observed hit point: a card's centre may contain a separate Save/Compare button.
    const border=await carrier.evaluate((el,point)=>{
      if(!(el instanceof HTMLAnchorElement) || el.href!==point.href || el.hasAttribute('download'))return null;
      const root=el.getRootNode();
      const hit=(root instanceof ShadowRoot ? root : el.ownerDocument).elementFromPoint(point.x,point.y);
      if(hit?.closest('a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch]')!==el)return null;
      for(let n:Element|null=el;n;n=n.parentElement){
        const style=getComputedStyle(n);
        if(style.rotate && style.rotate!=='none' && style.rotate!=='0deg')return null;
        if(style.transform!=='none'){
          const matrix=new DOMMatrixReadOnly(style.transform);
          if(!matrix.is2D || matrix.a<=0 || matrix.d<=0 || Math.abs(matrix.b)>1e-7 || Math.abs(matrix.c)>1e-7)return null;
        }
      }
      const style=getComputedStyle(el);
      return {left:parseInt(style.borderLeftWidth,10)||0,top:parseInt(style.borderTopWidth,10)||0};
    },point).catch(()=>null);
    if(!border)return false;
    // Playwright adds position to its page-space bounding box and border; it does not scale the offset.
    const position={x:originalBox.x+originalBox.width/2-carrierBox.x-border.left,y:originalBox.y+originalBox.height/2-carrierBox.y-border.top};
    if(position.x<0 || position.y<0 || position.x>carrierBox.width || position.y>carrierBox.height)return false;
    await carrier.click({timeout,position});return true;
  }finally{await handle.dispose().catch(()=>{});}
}

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
    if (kind === "click") {
      if (risk === 'read' && !params.force && await clickCoveredLink(target,timeout)) return;
      return target.click({ timeout, force: Boolean(params.force) });
    }
    if (kind === "hover") return target.hover({ timeout, force: Boolean(params.force) });
    if (kind === "press") return target.press(params.key || "", { timeout });
    if (params.read === "section") return await target.evaluate((el: Element) => {
          const ws = /\s+/g;
          const H = "h1, h2, h3, h4, h5, h6, [role=heading]";
          const rendering = {read(node: Element) {
            const style = getComputedStyle(node);
            return !node.matches('script, style, template, noscript') && style.display !== 'none';
          }};
          const head = el.closest(H) || el.querySelector(H) || el;
          const level = /^H[1-6]$/.test(head.tagName) ? Number(head.tagName[1]) : Number(head.getAttribute("aria-level") || 2);
          // Headings are often wrapped with small extras (<div><h2>..</h2>[edit]</div>): start after the wrapper.
          let start: Element = head;
          while (start.parentElement && start.parentElement !== document.body && ((start.parentElement as HTMLElement).innerText || "").length <= ((head as HTMLElement).innerText || "").length + 40) start = start.parentElement;
          const parts: string[] = [];
          let size = 0;
          for (let n = start.nextElementSibling; n && size < 6000; n = n.nextElementSibling) {
            if (!rendering.read(n)) continue;
            const h = n.matches(H) ? n : n.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role=heading]");
            if (h && rendering.read(h) && (getComputedStyle(h).visibility === 'visible' || Boolean((h as HTMLElement).innerText?.trim())) && (/^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : Number(h.getAttribute("aria-level") || 2)) <= level) break;
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
