import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { AppConfig } from "../config";
import { redactText } from "../utils/strings";
import { DEEP_WALK_JS, detectBlock, inspectPageState, type BlockInfo, type PageStateInfo } from "../engine/page-state";
import { REFERENCE_GUARD, type ElementReferences } from "./references";

export interface SnapshotElement {
  ref?: string;
  tag: string;
  // Explicit role, or the implicit one from the tag/type (input type=search -> searchbox), usable with --role.
  role?: string;
  name?: string;
  nameTruncated?: boolean;
  text?: string;
  testId?: string;
  placeholder?: string;
  label?: string;
  href?: string;
  // Short text just before a control that names its purpose ("Sort by:"), when the control's own name is its value.
  hint?: string;
  // Current text of a non-secret text field.
  value?: string;
  // aria-haspopup: what the control opens (menu, listbox, dialog...).
  popup?: string;
  // State, present only when the element has it. A label whose native checkbox/radio is visually hidden
  // (custom-styled controls) carries that control's state, since the label is what the agent can click.
  checked?: boolean | "mixed";
  selected?: boolean;
  selectedText?: string;
  expanded?: boolean;
  pressed?: boolean | "mixed";
  disabled?: boolean;
  // Heading of the card/section, on elements whose role+name repeats and whose heading is their own.
  context?: string;
  // Laid out but cut away by a collapsed overflow:hidden ancestor (e.g. a sub-filter that opens on hover);
  // "scroll" when the cutting container scrolls (actions scroll it into view by themselves).
  clipped?: true | "scroll";
  // opacity:0 control lying on top of its visible look (e.g. a menu checkbox over its label): the real click target.
  transparent?: true;
}

export interface HiddenMatch {
  tag: string;
  role?: string;
  name?: string;
  // Control that most likely reveals it (closed <details>, aria-controls owner, collapsed toggle just before).
  openWith?: { tag: string; role?: string; name?: string };
}

export interface TextHit {
  text: string;
  // Nearest clickable ancestor of the text, when there is one (custom span/div controls are often only this).
  clickable?: { tag: string; role?: string; name?: string };
  // A locator flag that reaches the text.
  use: string;
}

export interface PageSnapshot {
  observation?: { complete: boolean; errors: string[]; skippedNodes: number };
  pageState?: PageStateInfo;
  capturedAt: string;
  url: string;
  title: string;
  viewport?: { width: number; height: number };
  headings: string[];
  // Visible dialogs, menus and listboxes, e.g. "dialog Edit filters".
  open?: string[];
  elements: SnapshotElement[];
  truncated?: boolean;
  // When truncated: how many matching elements were left out, by the nearest preceding section title.
  omitted?: { count: number; byHeading: Record<string, number> };
  // With --query: matching controls that exist but are hidden (closed panel, collapsed section).
  hidden?: HiddenMatch[];
  // With --query: plain-text matches outside the listed controls (status text, custom span buttons).
  textHits?: TextHit[];
  // With --query and no match: closed <details>/collapsed toggles whose content is only rendered once opened.
  collapsed?: Array<{ tag: string; name: string; use: string }>;
  // Why the list is empty, when it is.
  diagnostics?: { shadowRoots: number; iframes: number; bodyTextLength: number; readyState: string };
  blocked?: BlockInfo;
  scanMs?: number;
}

export const DEFAULT_SNAPSHOT_LIMIT = 160;
const MAX_SNAPSHOT_LIMIT = 600;

// Page script (a source string: tsx would wrap named inner functions in `__name`, which the page lacks).
const SNAPSHOT_SCRIPT = `(opts) => {
  const started = performance.now();
  const limit = opts.limit;
  const query = opts.query ? opts.query.toLowerCase().replace(/\\s+/g, " ").trim() : "";
  ${DEEP_WALK_JS}

  const CAND = "a, button, input, select, textarea, label, summary, [role], [data-testid], [tabindex]:not([tabindex='-1']), [contenteditable=true]";
  const INTERACTIVE_DESC = "a[href], button, input, select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=option], [role=tab], [role=menuitem], [role=switch]";
  const CONTROL_TAGS = { INPUT: 1, BUTTON: 1, SELECT: 1, A: 1, TEXTAREA: 1 };
  const SECTION = "h1, h2, h3, h4, [role=heading], dt, legend";
  const OPEN = "dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true], [role=menu], [role=listbox]";
  const ICON_FONT = /icon|symbol|awesome|glyph/i;
  const STRUCTURAL = /^(main|region|navigation|banner|contentinfo|complementary|list|listitem|group|article|document|figure|table|rowgroup|row|cell|img|presentation|note|separator|toolbar|tabpanel|status|log|marquee|timer|feed|search|form|application|directory|definition|term)$/;

  function cleanStr(s) {
    if (!s || typeof s !== "string") return undefined;
    const trimmed = s.replace(/\\s+/g, " ").trim();
    return trimmed.length ? trimmed : undefined;
  }
  function rendered(el) {
    const style = getComputedStyle(el);
    if (style.display === "contents") return Array.from(el.children).some((c) => rendered(c));
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return style.visibility !== "hidden" && style.display !== "none";
  }
  function transparentSelf(el) { return getComputedStyle(el).opacity === "0"; }
  function isVisible(el) { return rendered(el) && !transparentSelf(el); }
  function hitsSelf(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    const root = el.getRootNode();
    const hit = (root.elementFromPoint ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y));
    if (!hit) return false;
    return hit === el || el.contains(hit) || (hit.tagName === "LABEL" && (hit.control === el || hit.contains(el)));
  }
  // An opacity:0 control that covers a real area (not a 1px visually-hidden input) and is the top-most element
  // at its own centre is what a click lands on.
  function onTop(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    return hitsSelf(el) === true;
  }
  // Zero visible area once overflow:hidden/clip/auto ancestors are applied. A fixed element escapes its ancestors.
  // A hit-test on the element itself overrides the geometry (a hover-opened sub-menu is reachable).
  function clipState(el) {
    if (getComputedStyle(el).position === "fixed") return undefined;
    const r = el.getBoundingClientRect();
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    let scrollable = false;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      const clipX = st.overflowX !== "visible";
      const clipY = st.overflowY !== "visible";
      if (clipX || clipY) {
        const b = n.getBoundingClientRect();
        if (clipX) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
        if (clipY) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
        if (right - left < 1 || bottom - top < 1) {
          if (hitsSelf(el) === true) return undefined;
          scrollable = n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1;
          return scrollable && (st.overflowY === "auto" || st.overflowY === "scroll" || st.overflowX === "auto" || st.overflowX === "scroll" || n.scrollTop > 0) ? "scroll" : true;
        }
      }
      if (st.position === "fixed") break;
    }
    return undefined;
  }

  // Visible text without icon-font ligatures ("arrow_drop_down") and aria-hidden decorations.
  function textOf(el) {
    if (!el.querySelector("[aria-hidden='true'], i, [class*='icon' i], [class*='material' i], [class*='symbol' i]")) return cleanStr(el.innerText);
    const parts = [];
    const skip = new Map();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      let bad = false;
      for (let p = t.parentElement; p && p !== el.parentElement; p = p.parentElement) {
        if (skip.has(p)) { bad = skip.get(p); if (bad) break; continue; }
        const st = getComputedStyle(p);
        const first = (st.fontFamily || "").split(",")[0];
        const b = p.getAttribute("aria-hidden") === "true" || ICON_FONT.test(first) || st.display === "none" || st.visibility === "hidden";
        skip.set(p, b);
        if (b) { bad = true; break; }
      }
      if (!bad) parts.push(t.textContent);
    }
    return cleanStr(parts.join(" "));
  }
  // A label's own words, without the text of controls inside it (a wrapping label around a select lists every option).
  function labelText(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button, option, [role=listbox], [role=option]").forEach((c) => c.remove());
    return cleanStr(clone.textContent);
  }
  function byIds(el, attr) {
    const ids = (el.getAttribute(attr) || "").split(/\\s+/).filter(Boolean);
    if (!ids.length) return undefined;
    const root = el.getRootNode();
    return cleanStr(ids.map((id) => { const t = root.getElementById ? root.getElementById(id) : document.getElementById(id); return t ? t.textContent : ""; }).join(" "));
  }
  function implicitRole(el, tag) {
    if (tag === "a") return el.hasAttribute("href") ? "link" : undefined;
    if (tag === "button") return "button";
    if (tag === "select") return (el.multiple || el.size > 1) ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      if (el.getAttribute("list")) return "combobox";
      return { checkbox: "checkbox", radio: "radio", range: "slider", number: "spinbutton", search: "searchbox",
        button: "button", submit: "button", reset: "button", image: "button", email: "textbox", tel: "textbox",
        url: "textbox", text: "textbox", password: "textbox" }[t];
    }
    return undefined;
  }
  function secret(el) {
    const auto = String(el.getAttribute("autocomplete") || "").toLowerCase();
    return el.type === "password" || auto.startsWith("cc-") || auto === "one-time-code" ||
      /\\b(cvc|cvv|otp|ssn)\\b/i.test((el.name || "") + " " + (el.id || ""));
  }
  function ariaState(el, attr) {
    const v = el.getAttribute(attr);
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "mixed") return "mixed";
    return undefined;
  }
  function stateOf(el, tag) {
    const s = {};
    if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) s.checked = el.indeterminate ? "mixed" : el.checked;
    else if (el.hasAttribute("aria-checked")) s.checked = ariaState(el, "aria-checked");
    else if (/^(menuitem|option|treeitem|listitem|gridcell)$/.test(el.getAttribute("role") || "") || tag === "li") {
      // A menu entry or option that wraps a (possibly hidden) checkbox/radio shows that box's state.
      const boxes = el.querySelectorAll("input[type=checkbox], input[type=radio], [role=checkbox], [role=radio]");
      if (boxes.length === 1) s.checked = boxes[0].tagName === "INPUT" ? boxes[0].checked : ariaState(boxes[0], "aria-checked");
    }
    if (tag === "select") {
      const chosen = Array.from(el.selectedOptions || []).map((o) => cleanStr(o.textContent)).filter(Boolean);
      if (chosen.length) s.selectedText = chosen.join(", ").slice(0, 120);
    } else if (tag === "option") s.selected = el.selected;
    else if (el.hasAttribute("aria-selected")) s.selected = ariaState(el, "aria-selected") === true;
    if (el.hasAttribute("aria-expanded")) s.expanded = ariaState(el, "aria-expanded") === true;
    else if (tag === "summary" && el.parentElement && el.parentElement.tagName === "DETAILS") s.expanded = el.parentElement.open;
    if (el.hasAttribute("aria-pressed")) s.pressed = ariaState(el, "aria-pressed");
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") s.disabled = true;
    return s;
  }
  // A visible label stands in for its custom checkbox/radio when the native input is hidden and not itself on top.
  function hiddenControlOf(el) {
    const control = el.control;
    if (!control || control.tagName !== "INPUT" || (control.type !== "checkbox" && control.type !== "radio")) return null;
    if (isVisible(control)) return null;
    if (rendered(control) && transparentSelf(control) && onTop(control)) return null;
    return control;
  }
  // Short text right before a control ("Sort by:"), for controls whose own name is only their current value.
  function hintOf(el) {
    let n = el.previousSibling;
    for (let hops = 0; n && hops < 3; hops++, n = n.previousSibling) {
      const t = n.nodeType === 3 ? cleanStr(n.textContent) : (n.nodeType === 1 && !n.matches(CAND) ? cleanStr(n.innerText) : undefined);
      if (t) return t.length <= 40 ? t : undefined;
    }
    const p = el.parentElement;
    if (p && !el.previousElementSibling && p.previousElementSibling && !p.previousElementSibling.matches(CAND)) {
      const t = cleanStr(p.previousElementSibling.innerText);
      if (t && t.length <= 40) return t;
    }
    return undefined;
  }
  function nameOf(el, tag, container) {
    const aria = cleanStr(el.getAttribute("aria-label")) || byIds(el, "aria-labelledby");
    if (aria) return aria;
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const lab = el.labels && el.labels[0] ? labelText(el.labels[0]) : undefined;
      return lab || cleanStr(el.getAttribute("placeholder")) || cleanStr(el.getAttribute("title")) || (tag === "input" && /button|submit|reset/.test(el.type) ? cleanStr(el.value) : undefined);
    }
    if (container) return undefined;
    const own = textOf(el);
    if (own) return own;
    const img = el.querySelector("img[alt]");
    if (img && cleanStr(img.alt)) return cleanStr(img.alt);
    const svgTitle = el.querySelector("svg title");
    if (svgTitle && cleanStr(svgTitle.textContent)) return cleanStr(svgTitle.textContent);
    return cleanStr(el.getAttribute("title"));
  }
  function ownHeading(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const hs = node.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]");
      if (!hs.length) continue;
      if (hs.length === 1 && !hs[0].contains(el)) return cleanStr(hs[0].innerText);
      return undefined;
    }
    return undefined;
  }
  function brief(el) {
    const tag = el.tagName.toLowerCase();
    const role = cleanStr(el.getAttribute("role")) || implicitRole(el, tag);
    const name = cleanStr(el.getAttribute("aria-label")) || (cleanStr(el.innerText) || cleanStr(el.textContent) || "").slice(0, 60) || undefined;
    return { tag, role, name };
  }
  function score(e) {
    if (!query) return 1;
    let best = 0;
    for (const [v, strong] of [[e.name, 1], [e.label, 1], [e.hint, 1], [e.placeholder, 1], [e.text, 0], [e.value, 0], [e.selectedText, 0], [e.testId, 0], [e.role, 0], [e.href, 0]]) {
      if (!v) continue;
      const s = String(v).toLowerCase();
      if (strong && s === query) best = Math.max(best, 3);
      else if (strong && s.startsWith(query)) best = Math.max(best, 2);
      else if (s.includes(query)) best = Math.max(best, 1);
    }
    return best;
  }

  const title = cleanStr(document.title) || "";
  const headings = [];
  const open = [];
  const matched = [];
  const hidden = [];
  let shadowRoots = 0;
  let order = 0;
  let section = "(top)";

  deepWalk((el) => {
    const tagU = el.tagName;
    if (tagU === "SCRIPT" || tagU === "STYLE" || tagU === "TEMPLATE" || tagU === "NOSCRIPT") return false;
    if (el.shadowRoot) shadowRoots++;
    if (el.matches(SECTION) && isVisible(el)) {
      const t = cleanStr(el.innerText);
      if (t) {
        section = t.slice(0, 60);
        if (/^H[123]$/.test(tagU) && headings.length < 20 && !query) headings.push(t);
      }
    }
    if (el.matches(OPEN) && rendered(el) && open.length < 6) {
      const n = cleanStr(el.getAttribute("aria-label")) || byIds(el, "aria-labelledby") || cleanStr((el.querySelector("h1, h2, h3, [role=heading]") || {}).innerText);
      open.push((el.getAttribute("role") || tagU.toLowerCase()) + (n ? " " + n.slice(0, 60) : ""));
    }
    if (!el.matches(CAND)) return;
    const tag = tagU.toLowerCase();
    if (!rendered(el)) {
      // A matching control that exists but is hidden: tell the agent it is there and what may reveal it.
      if (query && hidden.length < 10 && (CONTROL_TAGS[tagU] || el.hasAttribute("role"))) {
        const n = cleanStr(el.getAttribute("aria-label")) || (el.labels && el.labels[0] ? labelText(el.labels[0]) : undefined) || cleanStr(el.textContent);
        if (n && n.length <= 120 && n.toLowerCase().includes(query)) {
          let openWith;
          for (let a = el.parentElement || (el.getRootNode().host || null), d = 0; a && d < 14 && !openWith; a = a.parentElement || (a.getRootNode().host || null), d++) {
            if (a.tagName === "DETAILS" && !a.open) { const s = a.querySelector(":scope > summary"); if (s) openWith = brief(s); }
            else if (a.id) { const c = a.getRootNode().querySelector("[aria-controls~='" + CSS.escape(a.id) + "']"); if (c) openWith = brief(c); }
            if (!openWith && a.previousElementSibling && a.previousElementSibling.getAttribute("aria-expanded") === "false") openWith = brief(a.previousElementSibling);
          }
          hidden.push({ ...brief(el), name: n.slice(0, 80), openWith });
        }
      }
      return;
    }
    let transparent = false;
    if (transparentSelf(el)) {
      if (!CONTROL_TAGS[tagU] && !el.hasAttribute("role")) return;
      if (!onTop(el)) return;
      transparent = true;
    }
    const hiddenControl = tagU === "LABEL" ? hiddenControlOf(el) : null;
    if (tagU === "LABEL" && !hiddenControl) return;
    const explicitRole = cleanStr(el.getAttribute("role"));
    if (explicitRole && (explicitRole === "generic" || explicitRole === "presentation" || explicitRole === "none")) return;
    // Structural roles (main, list, region...) are not actions; keep them only when they carry their own name.
    if (explicitRole && STRUCTURAL.test(explicitRole) && !cleanStr(el.getAttribute("aria-label")) && !el.hasAttribute("aria-labelledby") && !el.hasAttribute("data-testid")) return;
    // A tabindex-only element counts when it looks clickable and is not just a wrapper of other controls.
    if (!CONTROL_TAGS[tagU] && tagU !== "LABEL" && tagU !== "SUMMARY" && !explicitRole && !el.hasAttribute("data-testid") && !el.isContentEditable) {
      if (getComputedStyle(el).cursor !== "pointer" || el.querySelector(INTERACTIVE_DESC)) return;
    }
    const container = !CONTROL_TAGS[tagU] && Boolean(el.querySelector(INTERACTIVE_DESC));
    const role = explicitRole || implicitRole(el, tag);
    const fullName = nameOf(el, tag, container);
    const name = fullName ? fullName.slice(0, 120) : undefined;
    const inner = container ? undefined : textOf(el);
    const text = inner && name !== inner && !(tag === "select") ? inner.slice(0, 160) : undefined;
    const labelEl = el.labels && el.labels[0];
    const label = labelEl ? labelText(labelEl) : undefined;
    const entry = {
      tag,
      role: role || undefined,
      name: name || undefined,
      nameTruncated: fullName && fullName.length > 120 ? true : undefined,
      _fullName: fullName,
      text,
      testId: cleanStr(el.getAttribute("data-testid")),
      placeholder: cleanStr(el.getAttribute("placeholder")),
      label: label && label !== name ? label : undefined,
      href: cleanStr(el.getAttribute("href")),
      ...(hiddenControl ? stateOf(hiddenControl, "input") : stateOf(el, tag)),
    };
    if (opts.refs) {
      const guard = (${REFERENCE_GUARD})(el);
      let saved = opts.refs.ids.get(el);
      if (!saved || saved.guard !== guard) {
        if (opts.refs.next > opts.refs.max) throw new Error('Reference quota reached; open a new task session');
        saved = {id:opts.refs.next++,guard}; opts.refs.ids.set(el,saved);
      }
      entry.ref = 'e' + saved.id;
      entry._node = el;
      entry._guard = guard;
    }
    if ((tag === "input" && !/checkbox|radio|button|submit|reset|image|file|hidden/.test(el.type)) || tag === "textarea") {
      if (!secret(el) && el.value) entry.value = String(el.value).slice(0, 60);
    }
    if (el.getAttribute("aria-haspopup") && el.getAttribute("aria-haspopup") !== "false") entry.popup = el.getAttribute("aria-haspopup") === "true" ? "menu" : el.getAttribute("aria-haspopup");
    if ((role === "button" || role === "combobox" || tag === "select") && !cleanStr(el.getAttribute("aria-label"))) {
      const h = hintOf(el);
      if (h && h !== entry.name) entry.hint = h;
    }
    let s = score(entry);
    // A repeated short link/button ("Repository", "Select") also matches through its card heading.
    if (query && !s && (role === "link" || role === "button") && entry.name && entry.name.length <= 30) {
      const h = ownHeading(el);
      if (h && h.toLowerCase().includes(query)) { entry.context = h.slice(0, 80); s = 1; }
    }
    if (!s) return;
    if (transparent) entry.transparent = true;
    matched.push({ entry, el, s, order: order++, section });
  });

  if (query) matched.sort((a, b) => b.s - a.s || a.order - b.order);
  const picked = matched.slice(0, limit);
  const omittedBy = {};
  for (const m of matched.slice(limit)) omittedBy[m.section] = (omittedBy[m.section] || 0) + 1;
  for (const m of picked) {
    const c = clipState(m.el);
    if (c) m.entry.clipped = c;
  }

  // Repeated role+name: add each one's own heading; a heading shared inside the group says nothing, so drop it.
  const groups = {};
  picked.forEach((m, i) => {
    if (!m.entry.name || m.entry.context) return;
    const key = (m.entry.role || m.entry.tag) + "|" + m.entry.name;
    (groups[key] = groups[key] || []).push(i);
  });
  Object.keys(groups).forEach((key) => {
    const idx = groups[key];
    if (idx.length < 2 || idx.length > 100) return;
    const ctx = idx.map((i) => ownHeading(picked[i].el));
    const uses = {};
    ctx.forEach((c) => { if (c) uses[c] = (uses[c] || 0) + 1; });
    idx.forEach((i, k) => { if (ctx[k] && uses[ctx[k]] === 1) picked[i].entry.context = ctx[k].slice(0, 80); });
  });

  // Plain-text matches: status lines ("489 items") and custom span/div controls that are not in the list.
  const textHits = [];
  if (query) {
    const listed = new Set(picked.map((m) => m.el));
    const seenParents = new Set();
    const roots = [document];
    deepWalk((el) => { if (el.shadowRoot) roots.push(el.shadowRoot); });
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t && textHits.length < 8; t = walker.nextNode()) {
        if (!t.textContent || !t.textContent.toLowerCase().includes(query)) continue;
        const p = t.parentElement;
        if (!p || seenParents.has(p) || /^(SCRIPT|STYLE|NOSCRIPT|TITLE|OPTION)$/.test(p.tagName) || !isVisible(p)) continue;
        seenParents.add(p);
        let covered = false;
        for (const l of listed) if (l === p || l.contains(p)) { covered = true; break; }
        if (covered) continue;
        let clickable;
        for (let a = p, d = 0; a && d < 6; a = a.parentElement, d++) {
          if (a.matches(CAND) || a.hasAttribute("onclick") || getComputedStyle(a).cursor === "pointer") { clickable = brief(a); break; }
        }
        const text = (cleanStr(p.innerText) || "").slice(0, 100);
        const exact = cleanStr(p.innerText) || "";
        textHits.push({ text, clickable, use: exact.length <= 60 ? "--text " + JSON.stringify(exact) + " --exact" : "--text " + JSON.stringify(query) });
      }
    }
  }

  // Nothing matched: closed disclosures (<details>, aria-expanded=false toggles) may hold it, rendered only once open.
  const collapsed = [];
  if (query && !picked.length) {
    deepWalk((el) => {
      if (collapsed.length >= 8) return false;
      const isSummary = el.tagName === "SUMMARY" && el.parentElement && el.parentElement.tagName === "DETAILS" && !el.parentElement.open;
      const isToggle = el.getAttribute && el.getAttribute("aria-expanded") === "false";
      if (!(isSummary || isToggle) || !isVisible(el)) return;
      const n = cleanStr(el.getAttribute("aria-label")) || (cleanStr(el.innerText) || "").slice(0, 60);
      if (!n) return;
      collapsed.push({ tag: el.tagName.toLowerCase(), name: n, use: isSummary ? "--text " + JSON.stringify(n) + " --exact" : "--role " + (cleanStr(el.getAttribute("role")) || implicitRole(el, el.tagName.toLowerCase()) || "button") + " --name " + JSON.stringify(n) + " --exact" });
    });
  }

  const top = Object.entries(omittedBy).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const omittedCount = Math.max(0, matched.length - picked.length);
  return {
    observation: walkDiagnostics,
    url: location.href,
    title,
    viewport: { width: innerWidth, height: innerHeight },
    headings,
    open: open.length ? open : undefined,
    elements: picked.map((m) => m.entry),
    truncated: omittedCount > 0,
    omitted: omittedCount ? { count: omittedCount, byHeading: Object.fromEntries(top) } : undefined,
    hidden: hidden.length ? hidden : undefined,
    textHits: textHits.length ? textHits : undefined,
    collapsed: collapsed.length ? collapsed : undefined,
    diagnostics: picked.length ? undefined : {
      shadowRoots,
      iframes: document.querySelectorAll("iframe").length,
      bodyTextLength: ((document.body && document.body.innerText) || "").length,
      readyState: document.readyState,
    },
    scanMs: Math.round(performance.now() - started),
  };
}`;

export async function captureSnapshot(
  page: Page,
  options: { query?: string; selector?: string; limit?: number; references?: ElementReferences; waitMs?: number } = {}
): Promise<PageSnapshot> {
  const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_SNAPSHOT_LIMIT, MAX_SNAPSHOT_LIMIT));
  // The query is applied in the page before the element limit, so a match deep in a long page is not cut off.
  const opts = { query: options.query || "", limit };
  const capture = async (): Promise<any> => {
    if (!options.references) return page.evaluate(`(${SNAPSHOT_SCRIPT})(${JSON.stringify(opts)})`);
    const state = await options.references.snapshotState();
    const result = await page.evaluateHandle(({ script, options }) => eval(`(${script})`)(options), { script: SNAPSHOT_SCRIPT, options: { ...opts, refs: state.state } });
    try {
      const data: any = await result.evaluate((data: any) => ({ ...data, elements: data.elements.map(({ _node, ...metadata }: any) => metadata) }));
      const array = await result.getProperty("elements");
      const items = await array.getProperties();
      for (const [index, item] of items) {
        if (!/^\d+$/.test(index)) { await item.dispose(); continue; }
        const raw = data.elements[Number(index)];
        const node = await item.getProperty("_node");
        const element = node.asElement();
        if (element && raw?.ref) {
          const { _node, _guard, _fullName, ...metadata } = raw;
          options.references.retain(raw.ref, element as any, _guard, { ...metadata, name: _fullName || metadata.name }, state.generation);
        } else await node.dispose();
        await item.dispose();
      }
      await array.dispose();
      return data;
    } finally { await result.dispose(); }
  };
  let data: any;
  try { data = await capture(); }
  catch (error: any) {
    if (/context.*destroyed|cannot find context|document changed/i.test(error.message || '')) {
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      try { data = await capture(); } catch { /* Return an explicitly incomplete observation below. */ }
    }
    if (!data) data = { url: page.url(), title: await page.title().catch(() => ''), elements: [], headings: [],
      observation: { complete: false, errors: ['capture_failed'], skippedNodes: 0 } };
  }
  // Nothing yet right after a navigation: give the page a moment to render once.
  if (data.observation?.complete !== false && !data.elements?.length && !options.query && data.diagnostics?.readyState !== "complete") {
    await page.waitForLoadState("load", { timeout: 3000 }).catch(() => {});
    try { data = await capture(); } catch { data.observation = { complete: false, errors: ['capture_failed'], skippedNodes: 0 }; }
  }

  const elements = (data.elements || []).map(({ _node, _guard, _fullName, ...e }: any) => ({
    ...e,
    name: e.name ? redactText(e.name) : undefined,
    text: e.text ? redactText(e.text) : undefined,
    href: e.href ? redactText(e.href) : undefined,
    value: e.value ? redactText(e.value) : undefined,
    selectedText: e.selectedText ? redactText(e.selectedText) : undefined,
    context: e.context ? redactText(e.context) : undefined,
  }));

  return {
    capturedAt: new Date().toISOString(),
    observation: data.observation,
    pageState: await inspectPageState(page, data.observation, options.waitMs ?? (options.query ? 0 : 3000)),
    url: data.url,
    title: redactText(data.title),
    viewport: data.viewport,
    headings: (data.headings || []).map(redactText),
    open: data.open,
    elements,
    truncated: Boolean(data.truncated),
    omitted: data.omitted,
    hidden: data.hidden,
    textHits: data.textHits?.map((h: TextHit) => ({ ...h, text: redactText(h.text) })),
    collapsed: data.collapsed,
    diagnostics: data.diagnostics,
    blocked: await detectBlock(page),
    scanMs: data.scanMs,
  };
}

export async function saveSnapshot(config: AppConfig, sessionId: string, snapshot: PageSnapshot): Promise<string> {
  const file = path.join(config.runtimeDir, "snapshots", `${Date.now()}-${sessionId}.json`);
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return file;
}
