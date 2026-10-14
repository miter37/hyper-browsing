import { waitBeforeInput } from '../engine/input-pacing';
import type { Page } from "playwright";
import { captureSnapshot, type PageSnapshot, type SnapshotElement } from "./snapshot";
import { DEEP_WALK_JS, settle } from "../engine/page-state";
import { PRIVATE_FIELD_SCRIPT } from './private-fields';
import { redactContent, redactUrl } from '../utils/strings';

export interface AnnoyanceResult {
  dismissedCount: number;
  actions: string[];
  // Dismiss-like buttons left alone because nothing showed they belong to a consent banner or a popup.
  skipped: string[];
  // Keyword-matched fixed overlays that were found but not hidden (hidden only with consent text or forceHide).
  overlays: string[];
}

const DISMISS_MARK = "data-hb-dismiss";

// Page script for pass 1 (a source string: tsx would wrap named inner functions in `__name`, absent in the page).
const DISMISS_SCAN_SCRIPT = `(mark) => {
    const ACCEPT = ["동의", "모두 동의", "동의합니다", "수락", "확인", "accept", "accept all", "accept all cookies",
      "i agree", "agree", "allow all", "allow all cookies", "ok", "got it"];
    const DISMISS = ["닫기", "다음에", "나중에 하기", "오늘 하루 보지 않기", "close", "dismiss", "not now", "maybe later",
      "no thanks", "×", "✕"];
    const CONSENT_TEXT = /cookie|consent|gdpr|privacy|tracking|쿠키|개인정보|동의/i;
    const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const overlayOf = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.matches("dialog, [role=dialog], [role=alertdialog], [aria-modal=true]")) return n;
        const pos = getComputedStyle(n).position;
        if (pos === "fixed" || pos === "sticky") return n;
      }
      return null;
    };
    const hasUserInput = (root) => Array.from(root.querySelectorAll("input, textarea, select")).some((f) =>
      (f.type === "checkbox" || f.type === "radio") ? false : f.type !== "hidden" && f.type !== "submit" && f.type !== "button" && Boolean(f.value));
    const describe = (el, text) => \`\${el.tagName.toLowerCase()} "\${text.slice(0, 40)}"\`;

    const clicks = [];
    const skipped = [];
    const buttons = Array.from(document.querySelectorAll("button, [role=button], a, input[type=button], input[type=submit]"));
    for (const el of buttons) {
      if (!visible(el)) continue;
      const text = clean(el.innerText || el.value || "");
      const aria = clean(el.getAttribute("aria-label"));
      const phrase = (text || aria).toLowerCase();
      const isAccept = ACCEPT.includes(phrase);
      const isClose = DISMISS.includes(phrase) || DISMISS.includes(aria.toLowerCase()) ||
        el.matches(".modal-close, .popup-close, [data-testid='close-button']");
      if (!isAccept && !isClose) continue;
      const overlay = overlayOf(el);
      const consent = Boolean(overlay && CONSENT_TEXT.test(clean(overlay.innerText).slice(0, 2000)));
      if (isAccept && !consent) {
        if (!isClose) { skipped.push(\`\${describe(el, text || aria)}: no cookie/consent overlay around it\`); continue; }
      }
      if (!overlay) { skipped.push(\`\${describe(el, text || aria)}: not inside a dialog or fixed overlay\`); continue; }
      if (!consent && hasUserInput(overlay)) { skipped.push(\`\${describe(el, text || aria)}: its overlay holds filled fields\`); continue; }
      el.setAttribute(mark, String(clicks.length));
      clicks.push({ id: clicks.length, what: \`\${consent ? "consent" : "popup"} \${describe(el, text || aria)}\` });
    }
    return { clicks, skipped };
}`;

// Page script for pass 2: keyword-matched fixed overlays; hide consent ones (or all with forceHide), report the rest.
const OVERLAY_SCAN_SCRIPT = `(forceHide) => {
    const overlayKeywords = ["cookie", "consent", "gdpr", "modal", "dialog", "popup", "banner", "overlay", "backdrop"];
    const CONSENT_TEXT = /cookie|consent|gdpr|privacy|tracking|쿠키|개인정보|동의/i;
    let hidden = 0;
    const reported = [];
    for (const el of Array.from(document.querySelectorAll("div, section, aside"))) {
      const style = window.getComputedStyle(el);
      const isFixedOrAbsolute = style.position === "fixed" || (style.position === "absolute" && parseInt(style.zIndex, 10) > 100);
      if (!isFixedOrAbsolute || style.display === "none") continue;
      const idClass = (el.id + " " + el.className).toLowerCase();
      if (!overlayKeywords.some((kw) => idClass.includes(kw))) continue;
      const consent = CONSENT_TEXT.test((el.innerText || "").slice(0, 2000));
      const box = el.getBoundingClientRect();
      const inert = box.width * box.height < 1 || style.opacity === "0" || style.visibility === "hidden" || style.pointerEvents === "none";
      if (inert && !forceHide) continue;
      if (forceHide || consent) {
        el.style.display = "none";
        hidden++;
      } else {
        reported.push(\`\${el.tagName.toLowerCase()}\${el.id ? "#" + el.id : ""} .\${String(el.className).split(/\\s+/).slice(0, 2).join(".")}\`);
      }
    }
    // A modal's scroll lock is released only when something was actually hidden.
    if (hidden > 0 && document.body.style.overflow === "hidden") document.body.style.overflow = "auto";
    return { hidden, reported: reported.slice(0, 20) };
}`;

/**
 * 1. dismissAnnoyances
 * Closes cookie banners and popups, acting only on page evidence:
 * - an accept button ("Accept all", "동의", "확인", ...) is clicked only inside an overlay whose text is about
 *   cookies/consent/privacy;
 * - a close button ("Close", "닫기", "Not now", ...) is clicked only inside an overlay (dialog, aria-modal,
 *   fixed/sticky) that holds no field the user has already filled;
 * - button text must equal the phrase ("Close account" is not "Close").
 * Keyword-matched overlays are hidden only when they show consent text, or with forceHide; otherwise reported.
 */
export async function dismissAnnoyances(page: Page, options: { forceHide?: boolean } = {}): Promise<AnnoyanceResult> {
  const actions: string[] = [];

  // Pass 1: mark evidence-backed consent / close buttons in the page, then click them with real input.
  const found = await page.evaluate(`(${DISMISS_SCAN_SCRIPT})(${JSON.stringify(DISMISS_MARK)})`)
    .catch(() => ({ clicks: [] as Array<{ id: number; what: string }>, skipped: [] as string[] })) as
    { clicks: Array<{ id: number; what: string }>; skipped: string[] };

  for (const c of found.clicks) {
    const el = page.locator(`[${DISMISS_MARK}="${c.id}"]`).first();
    if (!(await el.isVisible().catch(() => false))) continue; // an earlier click already closed it
    await waitBeforeInput();
    if (!(await el.isVisible().catch(() => false))) continue;
    const ok = await el.click({ force: true, timeout: 500 }).then(() => true).catch(() => false);
    if (ok) {
      actions.push(`Clicked: ${c.what}`);
      await page.waitForTimeout(300);
    }
  }
  await page.evaluate((mark) => document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark)), DISMISS_MARK).catch(() => {});

  // Pass 2: remaining keyword-matched fixed overlays. Hide only consent overlays (or everything with forceHide).
  const pass2 = await page.evaluate(`(${OVERLAY_SCAN_SCRIPT})(${Boolean(options.forceHide)})`)
    .catch(() => ({ hidden: 0, reported: [] as string[] })) as { hidden: number; reported: string[] };

  if (pass2.hidden > 0) {
    actions.push(`Hid ${pass2.hidden} overlay elements (${options.forceHide ? "forceHide" : "cookie/consent text"})`);
  }

  return {
    dismissedCount: actions.length,
    actions,
    skipped: found.skipped.slice(0, 20),
    overlays: pass2.reported,
  };
}

export interface FormFieldInfo {
  tag: string;
  name?: string;
  id?: string;
  type?: string;
  label?: string;
  // fieldset legend / group name around the field
  group?: string;
  placeholder?: string;
  required: boolean;
  value?: string;
  selectedText?: string;
  checked?: boolean;
  role?: string;
  hidden?: true;
}

export interface FormInfo {
  formId?: string;
  formName?: string;
  action?: string;
  method?: string;
  fields: FormFieldInfo[];
  submitButton?: { tag: string; text?: string; role?: string };
}

// Page script for analyzeForms (a source string: tsx would wrap named inner functions in `__name`).
// Walks open shadow roots too; lists custom comboboxes ([role=combobox], aria-haspopup=listbox) with their shown value.
const FORMS_SCRIPT = `(() => {
  ${DEEP_WALK_JS}
  ${PRIVATE_FIELD_SCRIPT}
  function clean(s) { return (s || "").replace(/\\s+/g, " ").trim(); }
  function shown(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none";
  }
  function labelText(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button, option").forEach((c) => c.remove());
    return clean(clone.textContent);
  }
  function byIds(el, attr) {
    const ids = (el.getAttribute(attr) || "").split(/\\s+/).filter(Boolean);
    const root = el.getRootNode();
    return clean(ids.map((id) => { const t = root.getElementById ? root.getElementById(id) : document.getElementById(id); return t ? t.textContent : ""; }).join(" "));
  }
  const containers = [];
  const byContainer = new Map();
  deepWalk((el) => {
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return false;
    const native = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    const custom = !native && (el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox");
    if (!native && !custom) return;
    if (native && el.type === "hidden") return;
    const form = el.closest("form") || null;
    if (!byContainer.has(form)) { byContainer.set(form, []); containers.push(form); }
    const label = clean(el.getAttribute("aria-label")) || (el.getAttribute("aria-labelledby") ? byIds(el, "aria-labelledby") : "") ||
      (el.labels && el.labels[0] ? labelText(el.labels[0]) : "") || undefined;
    const groupEl = el.closest("fieldset, [role=group], [role=radiogroup]");
    const group = groupEl ? (clean((groupEl.querySelector(":scope > legend") || {}).textContent) || clean(groupEl.getAttribute("aria-label")) || undefined) : undefined;
    const sensitive = secret(el);
    const field = {
      tag: tag.toLowerCase(),
      role: custom ? "combobox" : undefined,
      name: el.name || undefined,
      id: el.id || undefined,
      type: native ? (el.type || undefined) : undefined,
      label,
      group: group ? group.slice(0, 80) : undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      required: Boolean(el.required || el.getAttribute("aria-required") === "true"),
      value: sensitive ? ((el.value || (custom && el.textContent)) ? "[HIDDEN]" : undefined)
        : custom ? (clean(el.value || el.textContent).slice(0, 80) || undefined) : (el.value || undefined),
      selectedText: tag === "SELECT" ? (Array.from(el.selectedOptions).map((o) => clean(o.textContent)).filter(Boolean).join(", ") || undefined) : undefined,
      checked: el.type === "checkbox" || el.type === "radio" ? Boolean(el.checked) : undefined,
      hidden: shown(el) ? undefined : true,
    };
    byContainer.get(form).push(field);
  });
  return containers.map((form) => {
    const fields = byContainer.get(form);
    const root = form || document.body;
    const btn = root.querySelector("button[type='submit'], input[type='submit'], button");
    return {
      formId: form ? (form.id || undefined) : "implicit_form",
      formName: form ? (form.getAttribute("name") || form.getAttribute("aria-label") || undefined) : undefined,
      action: form ? (form.action || undefined) : undefined,
      method: form ? (form.method || undefined) : undefined,
      fields,
      submitButton: btn ? { tag: btn.tagName.toLowerCase(), text: clean(btn.innerText) || btn.getAttribute("value") || btn.getAttribute("aria-label") || undefined, role: btn.getAttribute("role") || undefined } : undefined,
    };
  });
})()`;

/**
 * 2. analyzeForms
 * Inspects input forms (including inside open shadow roots and custom comboboxes): fields, labels, groups,
 * current values (secret ones hidden), and submit buttons.
 */
export async function analyzeForms(page: Page): Promise<{ formsCount: number; forms: FormInfo[] }> {
  const forms = (await page.evaluate(FORMS_SCRIPT).catch(() => [])) as FormInfo[];
  return {
    formsCount: forms.length,
    forms: forms.map(form=>({...form,...(form.action?{action:redactUrl(form.action)}:{}),fields:form.fields.map(field=>Object.fromEntries(Object.entries(field).map(([key,value])=>[key,typeof value==='string'?redactContent(value):value])) as unknown as FormFieldInfo)})),
  };
}

export interface ListItem { title?: string; href?: string; text: string; titleTruncated:boolean; titleLength:number; titleShown:number; textTruncated:boolean; textLength:number; textShown:number; lengthUnit:'unicode-code-point' }

// Page script for listItems: the largest run of same-shaped siblings that each hold a link or a heading
// (result cards, table rows, list items), read item by item. Walks open shadow roots.
const LIST_SCRIPT = `(opts) => {
  ${DEEP_WALK_JS}
  function clean(s) { return (s || "").replace(/\\s+/g, " ").trim(); }
  function shown(el) {
    const st = getComputedStyle(el);
    if (st.display === "contents") return Array.from(el.shadowRoot ? el.shadowRoot.children : el.children).some((c) => shown(c));
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return st.visibility !== "hidden" && st.display !== "none";
  }
  function shape(el) { return el.tagName + "." + Array.from(el.classList).slice(0, 2).sort().join("."); }
  // Items may be web components whose content lives in their own shadow root.
  function q(k, sel) { return k.querySelector(sel) || (k.shadowRoot ? k.shadowRoot.querySelector(sel) : null); }
  function textOf(k) { return clean(k.innerText || (k.shadowRoot ? k.shadowRoot.textContent : "")); }
  function headingOf(k) { return q(k, "h1, h2, h3, h4, h5, h6, [role=heading]"); }
  const query = (opts.query || "").toLowerCase();
  const CHROME = "nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=menu], [role=menubar]";
  const groups = [];
  deepWalk((el) => {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "HEAD") return false;
    // Site chrome (nav menus, header, footer, sidebars) repeats links too, but is never the result list.
    if (el.matches(CHROME) || el.closest(CHROME)) return false;
    const kids = Array.from(el.children);
    if (kids.length < 3) return;
    const counts = {};
    for (const k of kids) counts[shape(k)] = (counts[shape(k)] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top[1] < 3) return;
    const items = kids.filter((k) => shape(k) === top[0] && shown(k) && q(k, "a[href], h1, h2, h3, h4, h5, h6, [role=heading]"));
    if (items.length < 3) return;
    const hits = query ? items.filter((k) => textOf(k).toLowerCase().includes(query)).length : 0;
    if (query && !hits) return;
    const sample = items.slice(0, 5);
    const textLen = sample.reduce((sum, k) => sum + textOf(k).length, 0) / sample.length;
    const inMain = Boolean(el.closest("main, [role=main]"));
    groups.push({ el, items, score: ((query ? hits * 100 : 0) + items.length * Math.min(textLen, 200)) * (inMain ? 2 : 1) });
  });
  groups.sort((a, b) => b.score - a.score);
  if (!groups.length) return { found: false };
  const g = groups[0];
  const items = g.items.slice(0, opts.limit).map((k) => {
    const h = headingOf(k);
    const a = q(k, "a[href]");
    const title = Array.from(clean(h ? (h.innerText || h.textContent) : (a ? (a.innerText || a.textContent) : "")));
    const text = Array.from(textOf(k));
    return {
      title: title.slice(0, 120).join("") || undefined,
      href: a ? a.href : undefined,
      text: text.slice(0, 200).join(""),
      titleTruncated: title.length > 120, titleLength: title.length, titleShown: Math.min(title.length,120),
      textTruncated: text.length > 200, textLength: text.length, textShown: Math.min(text.length,200), lengthUnit: "unicode-code-point",
    };
  });
  const c = g.el;
  return {
    found: true,
    container: c.tagName.toLowerCase() + (c.id ? "#" + c.id : "") + (c.classList.length ? "." + Array.from(c.classList).slice(0, 2).join(".") : ""),
    total: g.items.length,
    items,
    otherGroups: groups.length - 1,
  };
}`;

/** Reads a repeated list (search results, cards, rows) as items: {title, href, text}. */
export async function listItems(page: Page, options: { query?: string; limit?: number } = {}) {
  const opts = JSON.stringify({ query: options.query || "", limit: Math.max(1, Math.min(Number(options.limit) || 10, 50)) });
  return page.evaluate(`(${LIST_SCRIPT})(${opts})`);
}

export interface SnapshotDiff {
  urlChanged: boolean;
  oldUrl: string;
  newUrl: string;
  titleChanged: boolean;
  oldTitle: string;
  newTitle: string;
  addedElements: SnapshotElement[];
  removedElements: SnapshotElement[];
  // Same element (by tag/role/name/text/testId), different checked/selected/expanded/pressed/disabled state.
  stateChanges: Array<{ element: string; before: Record<string, unknown>; after: Record<string, unknown> }>;
  alertOrErrors: string[];
}

const STATE_FIELDS = ["checked", "selected", "selectedText", "expanded", "pressed", "disabled"] as const;

function stateOf(e: SnapshotElement): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const f of STATE_FIELDS) if (e[f] !== undefined) s[f] = e[f];
  return s;
}

/**
 * 3. compareSnapshots
 * Diffs two snapshots (before and after an action) to pinpoint what changed and if errors appeared.
 */
export function compareSnapshots(before: PageSnapshot, after: PageSnapshot): SnapshotDiff {
  const elKey = (e: SnapshotElement) => `${e.tag}|${e.role || ""}|${e.name || ""}|${e.text || ""}|${e.testId || ""}`;

  const beforeMap = new Set(before.elements.map(elKey));
  const afterMap = new Set(after.elements.map(elKey));

  const addedElements = after.elements.filter((e) => !beforeMap.has(elKey(e)));
  const removedElements = before.elements.filter((e) => !afterMap.has(elKey(e)));

  // Keys that occur once on each side can be paired safely; repeated keys cannot.
  const uniqueByKey = (elements: SnapshotElement[]) => {
    const map = new Map<string, SnapshotElement | null>();
    for (const e of elements) map.set(elKey(e), map.has(elKey(e)) ? null : e);
    return map;
  };
  const beforeUnique = uniqueByKey(before.elements);
  const stateChanges: SnapshotDiff["stateChanges"] = [];
  for (const [key, a] of uniqueByKey(after.elements)) {
    const b = beforeUnique.get(key);
    if (!a || !b) continue;
    const sb = stateOf(b), sa = stateOf(a);
    if (JSON.stringify(sb) !== JSON.stringify(sa)) {
      stateChanges.push({ element: `${a.tag}${a.role ? `[${a.role}]` : ""} ${a.name || a.text || a.testId || ""}`.trim(), before: sb, after: sa });
    }
  }

  // Identify new alert/error messages
  const alertOrErrors: string[] = [];
  for (const el of addedElements) {
    if (el.role === "alert" || el.testId?.includes("error") || el.name?.includes("오류") || el.name?.includes("실패") || el.name?.includes("Error")) {
      alertOrErrors.push(el.text || el.name || JSON.stringify(el));
    }
  }

  return {
    urlChanged: before.url !== after.url,
    oldUrl: before.url,
    newUrl: after.url,
    titleChanged: before.title !== after.title,
    oldTitle: before.title,
    newTitle: after.title,
    addedElements: addedElements.slice(0, 50),
    removedElements: removedElements.slice(0, 50),
    stateChanges: stateChanges.slice(0, 50),
    alertOrErrors,
  };
}

export interface ApiSniffResult {
  endpoint: string;
  method: string;
  status: number;
  contentType: string;
  dataPreview: any;
}

/**
 * 4. sniffApi
 * Sniffs backend API calls (JSON responses) during a specified quiet window.
 */
export async function sniffApi(page: Page, durationMs = 2500): Promise<{ count: number; apis: ApiSniffResult[] }> {
  const captured: ApiSniffResult[] = [];

  const onResponse = async (res: any) => {
    try {
      const url = res.url();
      const contentType = res.headers()["content-type"] || "";
      if (contentType.includes("application/json") || url.includes("/api/") || url.includes(".json")) {
        const text = await res.text().catch(() => "");
        let dataPreview: any = text;
        try {
          const parsed = JSON.parse(text);
          dataPreview = Array.isArray(parsed) ? parsed.slice(0, 3) : parsed;
        } catch {}

        captured.push({
          endpoint: url,
          method: res.request().method(),
          status: res.status(),
          contentType,
          dataPreview,
        });
      }
    } catch {}
  };

  page.on("response", onResponse);
  await page.waitForTimeout(durationMs);
  page.off("response", onResponse);

  return {
    count: captured.length,
    apis: captured.slice(0, 20),
  };
}

/**
 * 5. waitForIdle
 * Intelligently waits for DOM mutations and network calls to settle.
 */
export async function waitForIdle(page: Page, timeoutMs = 10000, minQuietMs = 500): Promise<{ settled: boolean; elapsedMs: number }> {
  const start = Date.now();
  // Network-idle rarely happens on ad/analytics-heavy sites, so it only gets a short look; the DOM going quiet
  // is what tells that rendering has finished.
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 1000) }).catch(() => {});
  const quiet = await settle(page, { quietMs: minQuietMs, maxMs: Math.max(minQuietMs, timeoutMs - (Date.now() - start)) });
  return { settled: quiet.settled, elapsedMs: Date.now() - start };
}

/**
 * 6. scrollPage
 * Smoothly or directly scrolls the page or a target container to trigger lazy loading / infinite scroll.
 */
export async function scrollPage(
  page: Page,
  options: { direction?: "down" | "up"; distance?: number; times?: number; selector?: string; delayMs?: number } = {}
): Promise<{ scrolled: boolean; times: number; totalDistance: number }> {
  const direction = options.direction === "up" ? -1 : 1;
  const distance = (options.distance || 800) * direction;
  const times = Math.max(1, Math.min(options.times || 1, 20));
  const delayMs = options.delayMs || 300;
  const selector = options.selector;

  let totalDistance = 0;
  for (let i = 0; i < times; i++) {
    await page.evaluate(({ dist, sel }) => {
      if (sel) {
        const el = document.querySelector(sel);
        if (el) el.scrollTop += dist;
      } else {
        window.scrollBy(0, dist);
      }
    }, { dist: distance, sel: selector });

    totalDistance += Math.abs(distance);
    if (i < times - 1 && delayMs > 0) {
      await page.waitForTimeout(delayMs);
    }
  }

  // Small settle wait
  await page.waitForTimeout(200);
  return { scrolled: true, times, totalDistance };
}

/**
 * 7. waitForElement
 * Waits for an element matching a CSS selector or visible text to appear in DOM within timeout.
 */
export async function waitForElement(
  page: Page,
  options: { css?: string; text?: string; timeoutMs?: number; state?: "visible" | "attached" } = {}
): Promise<{ found: boolean; selector?: string; elapsedMs: number }> {
  const start = Date.now();
  const timeout = options.timeoutMs || 5000;
  const state = options.state || "visible";

  try {
    if (options.css) {
      await page.locator(options.css).first().waitFor({ timeout, state });
      return { found: true, selector: options.css, elapsedMs: Date.now() - start };
    }
    if (options.text) {
      await page.getByText(options.text).first().waitFor({ timeout, state });
      return { found: true, selector: `text=${options.text}`, elapsedMs: Date.now() - start };
    }
    throw new Error("Specify either --css or --text for wait-for");
  } catch {
    return { found: false, selector: options.css || options.text, elapsedMs: Date.now() - start };
  }
}
