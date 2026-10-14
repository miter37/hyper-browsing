import type { ActionDefinition } from "../schema/site";
import type { ActionTarget } from '../runtime/references';

export type Risk = "read" | "local_write" | "external_write" | "irreversible" | "unclassified";

const rank: Record<Risk, number> = { read: 0, local_write: 1, external_write: 2, irreversible: 3, unclassified: 4 };
export const irreversible = /\b(delete|destroy|remove[_ ]account|close[_ ]account|erase|terminate)\b|삭제|계정.{0,4}탈퇴/i;
export const externalWrite = /\b(pay|payment|purchase|buy|checkout|submit|send|post|comment|invite|refund|transfer|publish|permission|grant|revoke|update|edit|save)\b|add to (cart|bag)|구매|결제|발송|전송|송금|게시|저장/i;

export function effectiveRisk(actionId: string, action: ActionDefinition): Risk {
  // A declarative extraction has no state-changing steps; names like account_status do not make it a write.
  if (action.risk === "read" && action.implementation.kind === "declarative" && action.implementation.steps.length === 0 && action.returns?.extractor && !action.variants) return "read";
  let inferred: Risk = "read";
  const haystack = [actionId];
  if (action.implementation.kind === "declarative") {
    for (const step of action.implementation.steps as any[]) {
      if (step.element) haystack.push(step.element);
      if (step.op) haystack.push(step.op);
    }
  }
  const text = haystack.join(" ").replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  if (irreversible.test(text)) inferred = "irreversible";
  else if (externalWrite.test(text)) inferred = "external_write";
  const declared = action.risk as Risk;
  return rank[inferred] > rank[declared] ? inferred : declared;
}

export function requiresConfirmation(risk: Risk): boolean {
  return risk === "external_write" || risk === "irreversible" || risk === "unclassified";
}

export function isWriteLike(risk: Risk): boolean {
  return risk !== "read";
}

export function heuristicRiskFromText(text: string): Risk {
  text = text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  if (irreversible.test(text)) return "irreversible";
  if (externalWrite.test(text)) return "external_write";
  return "read";
}

/** Inspect the pinned element, never the selector or the destination hostname. */
export async function riskFromTarget(target: ActionTarget, submission=false): Promise<Risk> {
  const data = await target.evaluate((el,submission) => {
    // Authorize the owning control while keeping the clicked node pinned.
    const clickable=el.closest('button,a[href],input[type=submit],input[type=button],input[type=image],[role=button],[role=link],label,summary') || el;
    const control=clickable.tagName==='LABEL' ? (clickable as HTMLLabelElement).control || clickable : clickable;
    const names={read(node:Element):string {
      const root=node.getRootNode() as Document | ShadowRoot;
      const labelled=(node.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>root.getElementById?.(id)?.textContent||'').join(' ').trim();
      const nativeLabels=Array.from((node as HTMLInputElement).labels || []).map(label=>label.innerText||label.textContent||'').join(' ');
      const imageNames=[...node.querySelectorAll('img[alt]')].map(img=>img.getAttribute('alt')||'').join(' ');
      const buttonValue=node.tagName==='INPUT' && /^(submit|button|image)$/.test((node as HTMLInputElement).type) ? (node as HTMLInputElement).value : '';
      return [node.getAttribute('aria-label'),node.getAttribute('alt'),labelled,nativeLabels,imageNames,(node as HTMLElement).innerText||node.textContent,buttonValue].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    }};
    const form=(control as HTMLInputElement).form || control.closest('form');
    const submits=submission || Boolean(form && ((control.tagName==='BUTTON' && !/^(button|reset)$/.test((control as HTMLButtonElement).type)) || (control.tagName==='INPUT' && /^(submit|image)$/.test((control as HTMLInputElement).type))));
    const submitNames=submits&&form?[...form.elements].filter(b=> (b.tagName==='BUTTON' && !/^(button|reset)$/.test((b as HTMLButtonElement).type)) || (b.tagName==='INPUT' && /^(submit|image)$/.test((b as HTMLInputElement).type))).map(b=>names.read(b)).join(' '):'';
    const scope=clickable.closest('fieldset,[role=group],[role=radiogroup]');
    return {tag:control.tagName,role:control.getAttribute('role'),type:control.getAttribute('type'),
      name:names.read(control)+' '+(clickable!==control?names.read(clickable):'')+' '+submitNames,
      href:submits ? control.getAttribute('formaction')||form?.getAttribute('action')||control.getAttribute('href') : control.getAttribute('href'),base:location.href,
      context:scope?.getAttribute('aria-label')||scope?.querySelector('legend')?.textContent||(clickable.closest('ul,[role=tablist]') as HTMLElement)?.innerText||'',
      formSearch:Boolean(form?.querySelector('input[type=search],input[name=q],input[name=k]'))};
  },submission).catch(() => null);
  if (!data) return 'unclassified';
  let path = '';
  try { if (data.href) { const u = new URL(data.href,data.base); path=decodeURIComponent(u.pathname)+' '+[...u.searchParams.keys()].join(' '); } } catch { return 'unclassified'; }
  const label = data.name.replace(/([a-z])([A-Z])/g,'$1 $2');
  const direct = heuristicRiskFromText(label+' '+path);
  if (direct==='irreversible') return direct;
  if (/\b(checkout|payment|purchase|delete|transfer)\b/i.test(path)) return 'external_write';
  if (/^(checkbox|radio)$/.test(data.type || data.role || '') && /filter|sort/i.test(data.context)) return 'read';
  if (/search|검색/i.test(label) && (data.formSearch || /^(button|submit|search)$/.test(data.type || '') || data.tag==='BUTTON') && !/pay|purchase|delete|checkout/i.test(label)) return 'read';
  return direct;
}
