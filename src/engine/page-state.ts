import type { Page } from "playwright";
import {referencesFor} from '../runtime/references';
import {REGION_GUARD} from '../runtime/observation/scoping';

/*
 * Page-side helpers shared by snapshot, actions and diffs.
 * Page scripts are source strings: tsx wraps named inner functions in `__name`, which does not exist in the page.
 */

/**
 * `deepWalk(cb, max)` visits elements in tree order and descends into open shadow roots (a host's shadow content
 * first, then its light children), so web-component pages (whole apps inside shadow roots) are seen like any other.
 * `cb(el)` returning false skips that element's subtree.
 */
export const DEEP_WALK_JS = `
  const walkDiagnostics = { complete: true, errors: [], skippedNodes: 0 };
  function walkIssue(code) {
    walkDiagnostics.complete = false;
    walkDiagnostics.skippedNodes++;
    if (walkDiagnostics.errors.length < 6 && !walkDiagnostics.errors.includes(code)) walkDiagnostics.errors.push(code);
  }
  function deepWalk(cb, max, root) {
    const start = root || document.documentElement;
    const stack = start ? [start] : [];
    if (!stack.length) walkIssue('missing_document');
    let seen = 0;
    while (stack.length && seen < (max || 60000)) {
      const n = stack.pop();
      seen++;
      if (!n || n.nodeType !== 1) { walkIssue('invalid_node'); continue; }
      try { if (cb(n) === false) continue; }
      catch { walkIssue('node_observation_failed'); }
      const kids = [];
      for (const parent of [(() => { try { return n.shadowRoot; } catch { walkIssue('shadow_access_failed'); return null; } })(), n]) {
        if (!parent) continue;
        try {
          const children = parent.children;
          if (!children || (typeof children[Symbol.iterator] !== 'function' && !Number.isFinite(children.length))) throw new Error();
          for (const c of Array.from(children)) if (c && c.nodeType === 1) kids.push(c);
        } catch { walkIssue('children_access_failed'); }
      }
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    if (stack.length) walkIssue('node_limit');
    return seen;
  }
`;

export interface SettleResult { settled: boolean; ms: number }

const SETTLE_SCRIPT = `(opts) => new Promise((resolve) => {
  const started = performance.now();
  let timer;
  let cap;
  let observer;
  function done(quiet) {
    if (observer) observer.disconnect();
    clearTimeout(timer);
    clearTimeout(cap);
    resolve({ settled: quiet, ms: Math.round(performance.now() - started) });
  }
  observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => done(true), opts.quiet); });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  timer = setTimeout(() => done(true), opts.quiet);
  cap = setTimeout(() => done(false), opts.max);
})`;

/** Waits until the DOM stops changing for `quietMs` (at most `maxMs`); survives a navigation in between. */
export async function settle(page: Page, options: { quietMs?: number; maxMs?: number } = {}): Promise<SettleResult> {
  const opts = JSON.stringify({ quiet: options.quietMs ?? 300, max: options.maxMs ?? 1500 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await page.evaluate(`(${SETTLE_SCRIPT})(${opts})`)) as SettleResult;
    } catch {
      // The document was replaced mid-wait (navigation): wait for the new one, then measure again.
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    }
  }
  return { settled: false, ms: options.maxMs ?? 1500 };
}

export interface PageProbe {
  url: string;
  title: string;
  h1?: string;
  fields: Record<string, { label: string; value: string }>;
  states: Record<string, string>;
  open: string[];
  interactive: number;
  // Names of visible buttons/links/tabs (first 300), to report controls that appeared, disappeared or were renamed.
  names: string[];
  regions?: Array<{id:number;role:string}>;
}

// One cheap pass over the page: form values, ARIA states, open dialogs/menus, count of visible controls.
const PROBE_SCRIPT = `(state => {
  ${DEEP_WALK_JS}
  const CONTROL = "a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=option], [role=menuitem], [role=switch], [role=combobox], [contenteditable=true]";
  const OPEN = "dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true], [role=menu], [role=listbox]";
  function clean(s) { return (s || "").replace(/\\s+/g, " ").trim(); }
  function shown(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none";
  }
  function secret(el) {
    const auto = String(el.getAttribute("autocomplete") || "").toLowerCase();
    return el.type === "password" || auto.startsWith("cc-") || auto === "one-time-code" ||
      /\\b(cvc|cvv|otp|ssn)\\b/i.test((el.name || "") + " " + (el.id || ""));
  }
  function labelOf(el) {
    const a = clean(el.getAttribute("aria-label"));
    if (a) return a;
    if (el.labels && el.labels[0]) return clean(el.labels[0].textContent).slice(0, 60);
    return clean(el.getAttribute("placeholder")) || el.name || el.id || el.tagName.toLowerCase();
  }
  const fields = {};
  const states = {};
  const seenKeys = {};
  const open = [];
  const regions=[];
  let interactive = 0;
  const names = [];
  let h1;
  deepWalk((el) => {
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return false;
    if (!h1 && tag === "H1" && shown(el)) h1 = clean(el.innerText).slice(0, 120);
    const surfaces=el.matches(OPEN)||el.matches('[popover]:popover-open')?[el]:[];
    if(el.getAttribute('aria-expanded')==='true'&&shown(el))for(const id of (el.getAttribute('aria-controls')||'').split(/\\s+/)){const target=el.getRootNode().getElementById?.(id);if(target&&!surfaces.includes(target))surfaces.push(target);}
    for(const surface of surfaces)if(shown(surface)&&open.length<6){
      if(state&&regions.some(r=>state.observedIds.get(surface)===r.id))continue;
      const name=clean(surface.getAttribute('aria-label'))||clean((surface.querySelector('h1,h2,h3,[role=heading]')||{}).innerText)||'';
      open.push((surface.getAttribute('role')||surface.tagName.toLowerCase())+(name?' '+name.slice(0,60):''));
      if(state){let id=state.observedIds.get(surface);if(!id){id=state.observedNext++;state.observedIds.set(surface,id);}
       state.regionTargets.set(id,{ref:new WeakRef(surface),guard:(${REGION_GUARD})(surface)});while(state.regionTargets.size>64)state.regionTargets.delete(state.regionTargets.keys().next().value);
       regions.push({id,role:surface.getAttribute('role')||surface.tagName.toLowerCase()});}
    }
    if (el.matches(CONTROL) && shown(el)) {
      interactive++;
      if (names.length < 300 && /^(A|BUTTON|SUMMARY)$/.test(tag) || /^(button|link|tab|menuitem|option)$/.test(el.getAttribute("role") || "")) {
        const n = clean(el.getAttribute("aria-label")) || clean(el.innerText).slice(0, 50);
        if (n && names.length < 300) names.push(n);
      }
    }
    if ((tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") && el.type !== "hidden" && Object.keys(fields).length < 400) {
      const label = labelOf(el);
      let value;
      if (el.type === "checkbox" || el.type === "radio") value = el.checked ? "checked" : "unchecked";
      else if (tag === "SELECT") value = Array.from(el.selectedOptions || []).map((o) => clean(o.textContent)).join(", ");
      else value = secret(el) ? (el.value ? "[HIDDEN:" + el.value.length + "]" : "") : String(el.value || "").slice(0, 80);
      const base = el.id ? "#" + el.id : (el.name ? "@" + el.name + ":" + label : label);
      const n = (seenKeys[base] = (seenKeys[base] || 0) + 1);
      fields[n > 1 ? base + "~" + n : base] = { label, value };
    }
    if (Object.keys(states).length < 400 && shown(el)) {
      let s = "";
      for (const attr of ["aria-expanded", "aria-pressed", "aria-selected", "aria-checked"]) {
        if (el.hasAttribute(attr)) s += attr.slice(5) + "=" + el.getAttribute(attr) + " ";
      }
      if (s) {
        const name = clean(el.getAttribute("aria-label")) || clean(el.innerText).slice(0, 40);
        const base = (el.getAttribute("role") || tag.toLowerCase()) + " " + name;
        const n = (seenKeys["s:" + base] = (seenKeys["s:" + base] || 0) + 1);
        states[n > 1 ? base + " ~" + n : base] = s.trim();
      }
    }
  });
  return { url: location.href, title: document.title, h1, fields, states, open, interactive, names,regions };
})`;

export async function probePage(page: Page): Promise<PageProbe | null> {
  try{const state=await referencesFor(page).snapshotState();return await page.evaluate(({script,state})=>eval(script)(state),{script:PROBE_SCRIPT,state:state.state});}catch{return null;}
}

export interface PageChange {
  valueChanges?: Array<{ field: string; before: string; after: string }>;
  stateChanges?: Array<{ element: string; before?: string; after?: string; op?:'added'|'changed'|'removed' }>;
  stateChangesCoverage?: {complete:boolean;observed:number;shown:number;removed:number};
  opened?: string[];
  closed?: string[];
  interactiveDelta?: number;
  // Visible button/link names that appeared or disappeared (a renamed control shows in both).
  appeared?: string[];
  disappeared?: string[];
  regions?: Array<{id:number;role:string}>;
}

/** What changed on the page between two probes (bounded, for action responses). */
export function diffProbe(before: PageProbe | null, after: PageProbe | null): PageChange | undefined {
  if (!before || !after || before.url !== after.url) return undefined;
  const out: PageChange = {};
  const values: NonNullable<PageChange["valueChanges"]> = [];
  for (const [key, b] of Object.entries(before.fields)) {
    const a = after.fields[key];
    if (a && a.value !== b.value) values.push({ field: a.label, before: b.value, after: a.value });
  }
  if (values.length) out.valueChanges = values.slice(0, 6);
  const states: NonNullable<PageChange["stateChanges"]> = [];
  for (const key of new Set([...Object.keys(before.states), ...Object.keys(after.states)])) {
    if (before.states[key] !== after.states[key]) states.push({ element: key, before: before.states[key], after: after.states[key],op:after.states[key]===undefined?'removed':before.states[key]===undefined?'added':'changed' });
  }
  if (states.length) {
    states.sort((a,b)=>Number(a.op==='removed')-Number(b.op==='removed'));
    out.stateChanges=states.slice(0,6);
    if(states.length>6)out.stateChangesCoverage={complete:false,observed:states.length,shown:6,removed:states.filter(s=>s.op==='removed').length};
  }
  const opened = after.open.filter((o) => !before.open.includes(o));
  const closed = before.open.filter((o) => !after.open.includes(o));
  if (opened.length) out.opened = opened;
  if (closed.length) out.closed = closed;
  const beforeNames = new Set(before.names);
  const afterNames = new Set(after.names);
  const appeared = [...afterNames].filter((n) => !beforeNames.has(n));
  const disappeared = [...beforeNames].filter((n) => !afterNames.has(n));
  if (appeared.length && appeared.length <= 20) out.appeared = appeared.slice(0, 6);
  if (disappeared.length && disappeared.length <= 20) out.disappeared = disappeared.slice(0, 6);
  const delta = after.interactive - before.interactive;
  if (Math.abs(delta) >= 3) out.interactiveDelta = delta;
  if(Object.keys(out).length&&after.regions?.length){const previous=new Set(before.regions?.map(r=>r.id));const newly=after.regions.filter(r=>!previous.has(r.id));out.regions=newly.length?newly:after.regions;}
  return Object.keys(out).length ? out : undefined;
}

export interface BlockInfo { kind: string; evidence: string; hint: string }
export interface ObservationInfo { complete: boolean; errors: string[]; skippedNodes: number }
export interface PageStateInfo { state: 'ready'|'loading'|'blocked'|'navigation_error'|'partial'|'unknown'; evidence?: string; blocked?: BlockInfo }

/** Page operability, never a claim that a user's task succeeded. */
export async function inspectPageState(page: Page, observation?: ObservationInfo, waitMs = 0): Promise<PageStateInfo> {
  const deadline = Date.now() + Math.max(0, Math.min(waitMs, 3000));
  for (;;) {
    if (/^(chrome-error|edge-error):/.test(page.url())) return { state:'navigation_error',evidence:'browser error document' };
    const blocked = await detectBlock(page);
    if (blocked) return { state:'blocked',blocked,evidence:blocked.evidence };
    if (observation?.complete === false) return { state:'partial',evidence:observation.errors.join(', ') };
    const state = await page.evaluate(`(() => {
      if (!document.documentElement || !document.body) return {state:'unknown',evidence:'missing document'};
      const text=(document.body.innerText || '').replace(/\\s+/g,' ').trim();
      const busy=[...document.querySelectorAll('[aria-busy=true],[role=progressbar],[class*=skeleton],[data-testid*=skeleton]')].some(el=>{
        const r=el.getBoundingClientRect(), s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';
      });
      if (document.readyState==='loading' || (busy && (text.length<200 || /^(loading|please wait|잠시만 기다려)[. …!]*$/i.test(text)))) return {state:'loading',evidence:'visible loading markers without meaningful content'};
      if (text || document.querySelector('input,button,a[href],img,canvas,video')) return {state:'ready'};
      return {state:'unknown',evidence:'no meaningful page content'};
    })()`).catch(() => ({ state:'unknown',evidence:'page inspection failed' })) as PageStateInfo;
    if (state.state!=='loading' || Date.now()>=deadline) return state;
    await page.waitForTimeout(Math.min(150,deadline-Date.now()));
  }
}

const BLOCK_SCRIPT = `(() => {
  const title = (document.title || "").toLowerCase();
  const text = ((document.body && document.body.innerText) || "").slice(0, 3000).toLowerCase();
  const has = (sel) => Boolean(document.querySelector(sel));
  const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')].filter(el => {
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  if (dialogs.some(el => /robot or human|confirm that you(?:'re| are) human|verify you are (a )?human/i.test(el.innerText || '')))
    return { kind: 'captcha', evidence: 'visible human-verification dialog' };
  if (/__cf_chl|\\/cdn-cgi\\/challenge-platform/.test(location.href) || has("#challenge-form, #cf-challenge-running, iframe[src*='challenges.cloudflare.com']"))
    return { kind: "bot-challenge", evidence: "cloudflare challenge markers" };
  if (/just a moment|attention required|checking your browser|잠시만 기다리|보안 확인/.test(title) || /verify you are (a )?human|보안 확인 수행 중/.test(text))
    return { kind: "bot-challenge", evidence: "challenge page text: " + (document.title || "").slice(0, 60) };
  if (has("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='captcha']") && document.querySelectorAll("a[href], button, input").length < 15)
    return { kind: "captcha", evidence: "captcha frame on a nearly empty page" };
  return null;
})()`;

/** Recognizes bot-verification / captcha interstitials so the agent stops instead of probing a wall. */
export async function detectBlock(page: Page): Promise<BlockInfo | undefined> {
  const found = (await page.evaluate(BLOCK_SCRIPT).catch(() => null)) as { kind: string; evidence: string } | null;
  if (!found) return undefined;
  return { ...found, hint: "The site is showing a human-verification page. Do not retry blindly: ask the user (webctl browser reveal) or stop and report." };
}
