import type { Page } from "playwright";

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
  function deepWalk(cb, max) {
    const stack = [document.documentElement];
    let seen = 0;
    while (stack.length && seen < (max || 60000)) {
      const n = stack.pop();
      seen++;
      if (cb(n) === false) continue;
      const kids = [];
      if (n.shadowRoot) for (const c of n.shadowRoot.children) kids.push(c);
      for (const c of n.children) kids.push(c);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
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
}

// One cheap pass over the page: form values, ARIA states, open dialogs/menus, count of visible controls.
const PROBE_SCRIPT = `(() => {
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
  let interactive = 0;
  const names = [];
  let h1;
  deepWalk((el) => {
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return false;
    if (!h1 && tag === "H1" && shown(el)) h1 = clean(el.innerText).slice(0, 120);
    if (el.matches(OPEN) && shown(el) && open.length < 6) {
      const name = clean(el.getAttribute("aria-label")) || clean((el.querySelector("h1, h2, h3, [role=heading]") || {}).innerText) || "";
      open.push((el.getAttribute("role") || tag.toLowerCase()) + (name ? " " + name.slice(0, 60) : ""));
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
  return { url: location.href, title: document.title, h1, fields, states, open, interactive, names };
})()`;

export async function probePage(page: Page): Promise<PageProbe | null> {
  return (await page.evaluate(PROBE_SCRIPT).catch(() => null)) as PageProbe | null;
}

export interface PageChange {
  valueChanges?: Array<{ field: string; before: string; after: string }>;
  stateChanges?: Array<{ element: string; before?: string; after?: string }>;
  opened?: string[];
  closed?: string[];
  interactiveDelta?: number;
  // Visible button/link names that appeared or disappeared (a renamed control shows in both).
  appeared?: string[];
  disappeared?: string[];
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
    if (before.states[key] !== after.states[key]) states.push({ element: key, before: before.states[key], after: after.states[key] });
  }
  if (states.length) out.stateChanges = states.slice(0, 6);
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
  return Object.keys(out).length ? out : undefined;
}

export interface BlockInfo { kind: string; evidence: string; hint: string }

const BLOCK_SCRIPT = `(() => {
  const title = (document.title || "").toLowerCase();
  const text = ((document.body && document.body.innerText) || "").slice(0, 3000).toLowerCase();
  const has = (sel) => Boolean(document.querySelector(sel));
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
