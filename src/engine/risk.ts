import type { ActionDefinition } from "../schema/site";
import type { ActionTarget } from '../runtime/references';

export type Risk = "read" | "local_write" | "external_write" | "irreversible" | "unclassified";

const rank: Record<Risk, number> = { read: 0, local_write: 1, external_write: 2, irreversible: 3, unclassified: 4 };
export const irreversible = /\b(delete|destroy|remove[_ ]account|close[_ ]account|erase|terminate)\b|삭제|계정.{0,4}탈퇴/i;
export const externalWrite = /\b(pay|payment|purchase|buy|checkout|submit|send|post|comment|invite|refund|transfer|publish|permission|grant|revoke|update|edit|save|subscribe|follow|register|create|approve|reserve|book)\b|\b(place\s+(?:an?\s+)?order|confirm\s+(?:reservation|booking|order|purchase)|accept\s+invite|add\s+to\s+(?:cart|bag))\b|구매|결제|발송|전송|송금|게시|저장|예약|주문|등록|구독|팔로우/i;

export function effectiveRisk(actionId: string, action: ActionDefinition): Risk {
  // A declarative extraction has no state-changing steps; names like account_status do not make it a write.
  if (action.risk === "read" && action.implementation.kind === "declarative" && action.implementation.steps.length === 0 && action.returns?.extractor && !action.variants) return "read";
  let inferred: Risk = "read";
  const haystack = [actionId];
  let scriptWrites = false;
  if (action.implementation.kind === "declarative") {
    for (const step of action.implementation.steps as any[]) {
      if (step.element) haystack.push(step.element);
      if (step.op && step.op !== "script") haystack.push(step.op);
      if (step.op === "script" && scriptMutates(step.source)) scriptWrites = true;
    }
  }
  const text = haystack.join(" ").replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
  if (irreversible.test(text)) inferred = "irreversible";
  else if (externalWrite.test(text) || scriptWrites) inferred = "external_write";
  const declared = action.risk as Risk;
  return rank[inferred] > rank[declared] ? inferred : declared;
}

/**
 * Page scripts that can change something: clicks, form submits, synthetic events, writes through fetch/XHR,
 * typed values, storage, cookies and navigation. A script with any of these is not a read, whatever its label.
 */
export function scriptMutates(source: string): boolean {
  return /\.(click|submit|requestSubmit)\s*\(|dispatchEvent\s*\(|method\s*:\s*['"`](post|put|patch|delete)|\.open\s*\(\s*['"`](post|put|patch|delete)|navigator\.sendBeacon|\.(value|checked|innerHTML|textContent)\s*=(?!=)|(local|session)Storage\.(setItem|removeItem|clear)|document\.cookie\s*=(?!=)|location(\.href)?\s*=(?!=)|location\.(assign|replace)\s*\(/i.test(source);
}

export function requiresConfirmation(risk: Risk): boolean {
  return risk === "external_write" || risk === "irreversible" || risk === "unclassified";
}

export function isWriteLike(risk: Risk): boolean {
  return risk !== "read";
}

// Words that describe a state rather than ask for one: "예약 가능합니다" on a calendar day, "Sold out", "Available
// to book". Removed before the keyword test so an availability label does not read as a booking action.
const STATUS_PHRASES = /예약\s*(?:이\s*)?(?:가능|불가능?|마감|대기)(?:합니다|해요|함|한|하신)?|\b(?:not\s+)?available(?:\s+(?:to|for)\s+(?:book|booking|reserve|reservation|purchase))?\b|\bsold\s*out\b|\bfully\s+booked\b/gi;
export function withoutStatusPhrases(text: string): string { return text.replace(STATUS_PHRASES, ' '); }

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
    // Enter on a plain link is navigation, not form submission.
    const submits=Boolean(form && (submission || ((control.tagName==='BUTTON' && !/^(button|reset)$/.test((control as HTMLButtonElement).type)) || (control.tagName==='INPUT' && /^(submit|image)$/.test((control as HTMLInputElement).type)))));
    const submitNames=submits&&form?[...form.elements].filter(b=> (b.tagName==='BUTTON' && !/^(button|reset)$/.test((b as HTMLButtonElement).type)) || (b.tagName==='INPUT' && /^(submit|image)$/.test((b as HTMLInputElement).type))).map(b=>names.read(b)).join(' '):'';
    const scope=clickable.closest('fieldset,[role=group],[role=radiogroup]');
    return {tag:control.tagName,role:control.getAttribute('role'),type:control.getAttribute('type'),
      name:names.read(control)+' '+(clickable!==control?names.read(clickable):'')+' '+submitNames,
      href:submits ? control.getAttribute('formaction')||form?.getAttribute('action')||control.getAttribute('href') : control.getAttribute('href'),base:location.href,
      context:scope?.getAttribute('aria-label')||scope?.querySelector('legend')?.textContent||(clickable.closest('ul,[role=tablist]') as HTMLElement)?.innerText||'',
      submits,
      formGet:Boolean(form && (form.getAttribute('method')||'').trim().toLowerCase()==='get'),
      // A search form names itself: role=search, a search field, a query-like field name or label, or a search address.
      formSearch:Boolean(form && (form.closest('[role=search]') || form.querySelector('[role=search],input[type=search],[role=searchbox]')
        || [...form.querySelectorAll('input:not([type=hidden]):not([type=password])')].some(i=>/^(q|k|s|kw|ss|query|keyword|keywords|search[_-]?\w*|\w*[_-]?query|term)$/i.test(i.getAttribute('name')||'')
          || /search|query|검색|찾기|探す|搜索/i.test([i.getAttribute('placeholder'),i.getAttribute('aria-label'),i.id].join(' ')))
        || /\/(search|results?|find)\b/i.test(form.getAttribute('action')||'')))};
  },submission).catch(() => null);
  if (!data) return 'unclassified';
  let path = '';
  try { if (data.href) { const u = new URL(data.href,data.base); path=decodeURIComponent(u.pathname)+' '+[...u.searchParams.keys()].join(' '); } } catch { return 'unclassified'; }
  const label = withoutStatusPhrases(data.name.replace(/([a-z])([A-Z])/g,'$1 $2'));
  // Exempt only complete search-submit labels, including repeated accessible names.
  // Longer/compact actions such as SubmitOrder and every action-path cue stay protected.
  const actionLabel = data.submits && data.formSearch ? label.replace(/(?:\bsubmit\s+(?:search|query)\s*)+$/i,'search') : label;
  const direct = heuristicRiskFromText(actionLabel+' '+path);
  // Search wording must never downgrade an explicitly identified write.
  if (direct !== 'read') return direct;
  if (/\b(checkout|payment|purchase|delete|transfer)\b/i.test(path)) return 'external_write';
  if (/^(checkbox|radio)$/.test(data.type || data.role || '') && /filter|sort/i.test(data.context)) return 'read';
  // Unknown form submissions may mutate state even without a write keyword.
  // A form that declares method="get" only builds a URL to load (HTTP GET is a safe method).
  if (data.submits) return data.formSearch || data.formGet ? 'read' : 'unclassified';
  if (/\b(confirm|continue|complete|finish|proceed|done)\b|확정|완료/i.test(label)
    && (data.tag === 'BUTTON' || data.role === 'button' || data.type === 'button')) return 'unclassified';
  return 'read';
}
