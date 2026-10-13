import type { Locator, Page, Response } from "playwright";
import type { LocatorStrategy } from "../schema/site";
import { resolveUnique, type UniqueResolution } from "./locators";
import { detectBlock, diffProbe, probePage, settle } from "./page-state";
import { referencesFor, type ActionTarget } from "../runtime/references";
import { resolveElement, LocatorResolutionError } from "./locators";
import type { ElementDefinition } from "../schema/site";

/** Agent-driven actions fail fast instead of Playwright's 30 s default; `--timeout-ms` overrides. */
export const DEFAULT_ACTION_TIMEOUT_MS = 5000;

export type ActionKind = "click" | "hover" | "fill" | "press" | "extract" | "select";

export interface TargetState {
  url: string;
  attached: boolean;
  checked?: boolean | "mixed";
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean | "mixed";
  value?: string;
  clipped?: boolean;
  scrollClipped?: boolean;
}

// Page-side look at the target (no named inner functions: tsx would wrap them in `__name`, absent in the page).
// clipped: laid out but cut to zero area by an overflow ancestor (collapsed sub-menu, closed accordion), unless a
// hit-test at its centre reaches it (a hover-opened menu is reachable even when the geometry says otherwise).
const inspectTarget = (el: Element) => {
  const r = el.getBoundingClientRect();
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
  let clipped = r.width <= 0 || r.height <= 0;
  let scrollClipped = false;
  // A fixed element escapes its ancestors' overflow clipping; so does everything below a fixed ancestor.
  let escaped = getComputedStyle(el).position === "fixed";
  for (let n = el.parentElement; n && n !== document.documentElement && !clipped && !escaped; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (st.position === "fixed") escaped = true;
    const clipX = st.overflowX !== "visible";
    const clipY = st.overflowY !== "visible";
    if (!clipX && !clipY) continue;
    const b = n.getBoundingClientRect();
    if (clipX) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
    if (clipY) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    if (right - left < 1 || bottom - top < 1) {
      clipped = true;
      scrollClipped = n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1;
    }
  }
  if (clipped && r.width > 0 && r.height > 0) {
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
      const root = el.getRootNode() as Document | ShadowRoot;
      const hit = root.elementFromPoint ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit) || (hit.tagName === "LABEL" && ((hit as HTMLLabelElement).control === el || hit.contains(el))))) {
        clipped = false;
        scrollClipped = false;
      }
    }
  }
  // A label acts for its control; report the control's state.
  const control = el.tagName === "LABEL" ? ((el as HTMLLabelElement).control as HTMLElement | null) : null;
  const s = (control || el) as HTMLInputElement;
  const [ariaChecked, ariaExpanded, ariaSelected, ariaPressed] =
    ["aria-checked", "aria-expanded", "aria-selected", "aria-pressed"].map((name) => {
      const v = s.getAttribute(name);
      return v === "true" ? true : v === "false" ? false : v === "mixed" ? "mixed" as const : undefined;
    });
  const isBox = s.tagName === "INPUT" && (s.type === "checkbox" || s.type === "radio");
  const secret = s.type === "password" || /^cc-|one-time-code/.test(String(s.getAttribute("autocomplete") || ""));
  return {
    clipped,
    scrollClipped,
    checked: isBox ? (s.indeterminate ? "mixed" as const : s.checked) : ariaChecked,
    expanded: ariaExpanded === "mixed" ? undefined : ariaExpanded,
    selected: s.tagName === "OPTION" ? (s as unknown as HTMLOptionElement).selected : (ariaSelected === true ? true : ariaSelected === false ? false : undefined),
    pressed: ariaPressed,
    value: s.tagName === "SELECT"
      ? Array.from((s as unknown as HTMLSelectElement).selectedOptions).map((o) => (o.textContent || "").trim()).join(", ")
      : (s.tagName === "INPUT" && !isBox) || s.tagName === "TEXTAREA"
        ? (secret ? (s.value ? `[HIDDEN:${s.value.length}]` : "") : String(s.value ?? "").slice(0, 120))
        : s.isContentEditable ? String(s.innerText || "").slice(0, 120) : undefined,
  };
};

async function readTarget(page: Page, locator: ActionTarget): Promise<TargetState> {
  const url = page.url();
  if ((await locator.count().catch(() => 0)) === 0) return { url, attached: false };
  const info = await locator.evaluate(inspectTarget, undefined, { timeout: 1000 }).catch(() => null);
  if (!info) return { url, attached: false };
  return { url, attached: true, ...info };
}

const STATE_KEYS = ["checked", "expanded", "selected", "pressed", "value"] as const;

function firstLine(message: string): string {
  return message.split("\n")[0].slice(0, 300);
}

// The last lines of Playwright's call log say what it was waiting for ("element is not stable", "...intercepts").
function callLog(message: string): string[] | undefined {
  const i = message.indexOf("Call log:");
  if (i < 0) return undefined;
  const lines = message.slice(i + 9).split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  return lines.slice(-3).map((l) => l.slice(0, 200));
}

/** Turns Playwright's long retry log into a reason the agent can act on. */
export function classifyActionError(error: unknown) {
  const message = String((error as any)?.message || error);
  const log = callLog(message);
  if (/is not an <input>|not a <select>|is not a checkbox|not a select element|Element is not an? /i.test(message)) {
    return {
      reason: "wrong_element",
      hint: "This command does not apply to that kind of element. For a <select> or dropdown use `webctl select <locator> --option \"Text\"`; " +
        "for buttons/links use click; fill works on text inputs, textareas and contenteditable.",
      error: firstLine(message), log,
    };
  }
  const intercept = message.match(/(<[^\n]{1,200}?>)[^\n]*?intercepts pointer events/);
  if (intercept) {
    return {
      reason: "intercepted",
      interceptedBy: intercept[1],
      hint: "Another element lies on top of the target. If that element is the real control (e.g. a transparent " +
        "checkbox over its label; snapshot marks it transparent), act on it instead. Otherwise close the overlay " +
        "(dismiss-annoyances, or press Escape) or retry with --force.",
      error: firstLine(message), log,
    };
  }
  if (/not stable/i.test(message)) {
    return { reason: "not_stable", hint: "The target is still moving (animation). Retry once it settles.", error: firstLine(message), log };
  }
  if (/outside of the viewport/i.test(message)) {
    return { reason: "outside_viewport", hint: "Scroll the target into view (scroll) and retry.", error: firstLine(message), log };
  }
  if (/element is not visible|to be visible/i.test(message)) {
    return {
      reason: "not_visible",
      hint: "The target is hidden. It may live in a closed menu or collapsed section: open its parent first " +
        "(hover or click the parent), then retry.",
      error: firstLine(message), log,
    };
  }
  if (/not enabled|element is disabled/i.test(message)) {
    return { reason: "disabled", hint: "The target is disabled.", error: firstLine(message), log };
  }
  if (/Timeout \d+ms exceeded/i.test(message)) {
    return { reason: "timeout", hint: "The target did not become actionable in time; see log.", error: firstLine(message), log };
  }
  return { reason: "error", error: firstLine(message), log };
}

/** Responses for a locator that did not resolve to exactly one element: nothing was done. */
export function unresolvedResult(target: Exclude<UniqueResolution, { locator: Locator }>) {
  if ("ambiguous" in target) {
    return {
      ok: false,
      ambiguous: true,
      count: target.count,
      candidates: target.candidates,
      hint: "Several visible elements match. Re-run with --nth N (from candidates), --within \"<heading/section text>\", or a more specific locator.",
    };
  }
  if ("hiddenOnly" in target) {
    return {
      ok: false,
      reason: "hidden_only",
      hiddenCount: target.hiddenCount,
      alternatives: target.alternatives,
      hint: "Only hidden elements match (closed menu/panel, or a hidden duplicate). If an alternative below is the " +
        "visible control, use its `use` flags; otherwise open the parent first, or use snapshot --query to see `hidden`.",
    };
  }
  return {
    ok: false,
    reason: "no_match",
    suggestions: target.suggestions,
    hint: target.suggestions.length
      ? "Nothing matches this locator. Visible elements with similar words are listed with ready-to-use flags."
      : "Nothing matches this locator. Check snapshot (role names are implicit roles, e.g. searchbox, combobox).",
  };
}

export interface ActParams {
  locator?: LocatorStrategy;
  ref?: string;
  element?: ElementDefinition;
  nth?: number;
  within?: string;
  timeoutMs?: number;
  force?: boolean;
  value?: string;
}

/** The main-frame document response of a navigation started by the action, if any. */
function watchNavigation(page: Page) {
  let status: number | undefined;
  const onResponse = (res: Response) => {
    try {
      if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) status = res.status();
    } catch {}
  };
  page.on("response", onResponse);
  return { stop: () => page.off("response", onResponse), status: () => status };
}

/**
 * One agent action on one element: resolve uniquely, refuse what cannot work, act with a short timeout,
 * classify failures, wait for the page to settle and report what changed.
 * - unresolved locators (ambiguous / hidden only / no match) are answered with candidates or suggestions;
 * - a clipped target inside a scrolling container is scrolled into view; one inside a collapsed container is
 *   refused for click/hover/fill/select, even with --force (a forced click lands on whatever is drawn there);
 * - the effect lists URL change (with HTTP status, new title and h1), the target's own state change, and page-level
 *   changes elsewhere (field values, ARIA states, dialogs/menus opened or closed, controls appearing);
 * - a forced action with no observed effect says so instead of reporting plain success.
 */
export async function actOn<T>(
  page: Page,
  kind: ActionKind,
  params: ActParams,
  act: (locator: ActionTarget, timeoutMs: number) => Promise<T>,
): Promise<Record<string, any>> {
  const timeoutMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : DEFAULT_ACTION_TIMEOUT_MS;
  let target: { locator: ActionTarget; resolvedBy?: string; equivalentMatches?: number };
  if (params.element) {
    if (params.ref || params.locator) return { ok: false, reason: "invalid_target", execution: "not_started" };
    try { target = { locator: await resolveElement(page, params.element) }; }
    catch (error) {
      if (error instanceof LocatorResolutionError && !("locator" in error.result)) return { ...unresolvedResult(error.result), reason: "ambiguous" in error.result ? "ambiguous" : "hiddenOnly" in error.result ? "hidden_only" : "no_match", execution: "not_started" };
      throw error;
    }
  } else if (params.ref) {
    if (params.locator || params.nth !== undefined || params.within) return { ok: false, reason: "invalid_target", execution: "not_started" };
    const pinned = await referencesFor(page).resolve(params.ref);
    if (!("locator" in pinned)) return pinned;
    target = pinned;
  } else {
    if (!params.locator) return { ok: false, reason: "invalid_target", execution: "not_started" };
    let resolved;
    try { resolved = await resolveUnique(page, params.locator, params.nth, timeoutMs, params.within || params.locator.within); }
    catch (error: any) { return { ok: false, reason: "invalid_target", execution: "not_started", error: error.message }; }
    if (!("locator" in resolved)) return { ...unresolvedResult(resolved), reason: "ambiguous" in resolved ? "ambiguous" : "hiddenOnly" in resolved ? "hidden_only" : "no_match", execution: "not_started" };
    target = resolved;
  }
  const resolved = target.resolvedBy ? { resolvedBy: target.resolvedBy, equivalentMatches: target.equivalentMatches } : {};

  let before = await readTarget(page, target.locator);
  if (before.clipped && before.scrollClipped) {
    await target.locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    before = await readTarget(page, target.locator);
  }
  if (before.clipped && kind !== "extract" && kind !== "press") {
    // Which collapsed group hides it, and what that group's header is (text, a checkbox, an expand toggle).
    const collapsedUnder = await target.locator.evaluate((el) => {
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const b = n.getBoundingClientRect();
        const st = getComputedStyle(n);
        if ((st.overflowX !== "visible" || st.overflowY !== "visible") && (b.width < 1 || b.height < 1)) {
          const header = n.previousElementSibling || (n.parentElement && n.parentElement.firstElementChild !== n ? n.parentElement.firstElementChild : null);
          const toggle = n.parentElement && n.parentElement.querySelector("[aria-expanded='false'], summary, [aria-controls]");
          return {
            group: header ? String((header as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 60) : undefined,
            headerIsCheckbox: Boolean(header && header.querySelector("input[type=checkbox], [role=checkbox]")),
            toggle: toggle ? String((toggle as HTMLElement).innerText || toggle.getAttribute("aria-label") || toggle.tagName).trim().slice(0, 60) : undefined,
          };
        }
      }
      return undefined;
    }).catch(() => undefined);
    return {
      ok: false,
      reason: "clipped",
      execution: "not_started",
      ...resolved,
      collapsedUnder,
      hint: "The target is inside a collapsed container (zero visible area), so it cannot be clicked where it is drawn. " +
        (collapsedUnder?.toggle ? `Expand it with its toggle ("${collapsedUnder.toggle}") first. `
          : collapsedUnder?.headerIsCheckbox ? `Its group header "${collapsedUnder.group}" is itself a checkbox: on some sites the sub-options only open once that group is selected (which also selects it). `
          : "Open its parent first: hover its section/parent item (webctl hover) or click the section toggle. ") +
        "Then retry.",
    };
  }

  const probeBefore = kind === "extract" ? null : await probePage(page);
  const nav = watchNavigation(page);
  let value: T;
  try {
    value = await act(target.locator, timeoutMs);
  } catch (error) {
    nav.stop();
    const failure: Record<string, any> = { ok: false, ...classifyActionError(error), ...resolved, execution: "outcome_unknown" };
    if (failure.reason === "intercepted" || failure.reason === "timeout") {
      // Is a large overlay (open panel's scrim, modal) covering the target?
      const cover = await target.locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit)) return null;
        const b = hit.getBoundingClientRect();
        return { area: (b.width * b.height) / (innerWidth * innerHeight), tag: hit.tagName.toLowerCase(), cls: String(hit.className || "").slice(0, 60) };
      }).catch(() => null);
      if (cover && cover.area > 0.4) {
        const probe = await probePage(page);
        failure.reason = "blocked_by_overlay";
        failure.coveredBy = `${cover.tag}${cover.cls ? "." + cover.cls.split(/\s+/)[0] : ""}`;
        failure.open = probe?.open;
        failure.hint = "A panel, dialog or its backdrop covers most of the page. Finish or close it first (apply/close button, or press Escape), then retry.";
      }
    }
    return failure;
  }
  if (kind === "extract") { nav.stop(); return { ok: true, value, ...resolved, execution: "completed" }; }

  await settle(page, { quietMs: 300, maxMs: 1500 });
  if (page.url() !== before.url) await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  nav.stop();
  const after = await readTarget(page, target.locator);
  const probeAfter = await probePage(page);

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of STATE_KEYS) if (before[k] !== after[k] && after.attached) changes[k] = { before: before[k], after: after[k] };
  const urlChanged = before.url !== after.url;
  const targetGone = before.attached && !after.attached;
  const pageChange = urlChanged ? undefined : diffProbe(probeBefore, probeAfter);
  const effect: Record<string, any> = {
    urlChanged,
    url: after.url,
    targetChanged: Object.keys(changes).length ? changes : undefined,
    targetGone: targetGone || undefined,
    page: pageChange,
  };
  if (urlChanged) {
    effect.status = nav.status();
    effect.title = probeAfter?.title;
    effect.h1 = probeAfter?.h1;
    effect.blocked = await detectBlock(page);
  }
  effect.observed = urlChanged || targetGone || Object.keys(changes).length > 0 || Boolean(pageChange);
  if (!effect.observed && kind === "click" && after.attached) {
    // Clicking a heading or text that is not itself a control usually does nothing; its card link is nearby.
    const near = await target.locator.evaluate((el) => {
      const control = el.closest("a[href], button, [role=button], [role=link], input, select, label, summary");
      if (control) return undefined;
      const card = el.parentElement;
      const link = el.querySelector("a[href]") || (card && card.querySelector("a[href]")) ||
        (el.getRootNode() as ShadowRoot).host?.closest?.("a[href]") || null;
      return { notAControl: el.tagName.toLowerCase(), nearestLink: link ? { text: String((link as HTMLElement).innerText || "").trim().slice(0, 60), href: link.getAttribute("href") } : undefined };
    }).catch(() => undefined);
    if (near) effect.note = near.nearestLink
      ? `Clicked a ${near.notAControl}, which is not a control, and nothing changed. Nearest link: "${near.nearestLink.text}" (${near.nearestLink.href}) — use --role link / --css a[href="..."].`
      : `Clicked a ${near.notAControl}, which is not a control, and nothing changed.`;
  }
  const warning = !effect.observed && params.force
    ? "Forced action reported no observed effect (URL, target and page unchanged). Verify with snapshot before assuming it worked."
    : undefined;
  return { ok: true, value, effect, warning, ...resolved, execution: "completed" };
}

/** Selects an option of a native <select> by visible text (then by value), or of a custom combobox by clicking it open. */
export async function chooseOption(page: Page, locator: ActionTarget, option: string, timeoutMs: number): Promise<string> {
  const tag = await locator.evaluate((el) => el.tagName).catch(() => "");
  if (tag === "SELECT") {
    const options = await locator.evaluate(el => Array.from((el as HTMLSelectElement).options).map(o => ({ label: (o.textContent || "").trim(), value: o.value })));
    const labels = options.filter(o => o.label === option);
    const values = options.filter(o => o.value === option);
    const starts = options.filter(o => o.label.toLowerCase().startsWith(option.toLowerCase()));
    const matches = labels.length ? labels : values.length ? values : starts.length ? starts : options.filter(o => o.label.toLowerCase().includes(option.toLowerCase()));
    if (matches.length !== 1) throw new Error(`Ambiguous or missing option: ${option}`);
    // Value is used only when it too identifies a single option; otherwise use its unique label.
    const selected = matches[0];
    const chosen = await locator.selectOption(options.filter(o => o.value === selected.value).length === 1 ? { value: selected.value } : { label: selected.label }, { timeout: timeoutMs });
    // Report the chosen option's visible text ("Two"), not its value attribute ("2").
    return locator.evaluate((el) => Array.from((el as HTMLSelectElement).selectedOptions).map((o) => (o.textContent || "").trim()).join(", "))
      .catch(() => chosen.join(", "));
  }
  // Custom dropdown: open it, then click the visible option with that name.
  await locator.click({ timeout: timeoutMs });
  await settle(page, { quietMs: 200, maxMs: 1000 });
  const pools = [
    page.getByRole("option", { name: option, exact: true }),
    page.getByRole("menuitem", { name: option, exact: true }),
    page.getByRole("option", { name: option }),
    page.getByText(option, { exact: true }),
  ];
  for (const pool of pools) {
    const vis = pool.filter({ visible: true });
    if ((await vis.count()) === 1) {
      await vis.click({ timeout: timeoutMs });
      return option;
    }
    if ((await vis.count()) > 1) throw new Error(`Ambiguous option: ${option}`);
  }
  throw new Error(`Opened the dropdown but no visible option named "${option}" appeared.`);
}

/**
 * fill / select on one element. A <select> or custom dropdown is chosen by option text (`fill` on one does the same).
 * A text field is read back after filling: `valueMatches` false (with the actual value) when the page reformatted it,
 * kept chips, or did not clear it. Secret fields are never echoed, only their length and whether they match.
 */
export async function fillOrSelect(page: Page, kind: "fill" | "select", params: ActParams & { option?: string; submit?: boolean }) {
  const wanted = String(kind === "select" ? params.option : params.value ?? "");
  const outcome = await actOn(page, kind, params, async (locator, timeout) => {
    const element = await locator.evaluate((el) => {
      const tag = el.tagName;
      if (tag === "SELECT" || (el.getAttribute("role") === "combobox" && tag !== "INPUT" && tag !== "TEXTAREA")) return "choice";
      return (el as HTMLElement).isContentEditable ? "editable" : "text";
    }).catch(() => "text");
    if (kind === "select" || element === "choice") {
      return { kind: "choice", actual: await chooseOption(page, locator, wanted, timeout) };
    }
    await locator.fill(wanted, { timeout });
    const read = await locator.evaluate((el) => {
      const input = el as HTMLInputElement;
      const auto = String(el.getAttribute("autocomplete") || "").toLowerCase();
      const secret = input.type === "password" || auto.startsWith("cc-") || auto === "one-time-code";
      const value = (el as HTMLElement).isContentEditable ? (el as HTMLElement).innerText : String(input.value ?? "");
      return { value, secret };
    }).catch(() => null);
    if (params.submit) await locator.press("Enter", { timeout });
    return { kind: element, actual: read?.value, secret: read?.secret };
  });
  if (!outcome.ok) return outcome;
  const v = (outcome.value || {}) as { kind?: string; actual?: string; secret?: boolean };
  const normalize = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const res: Record<string, any> = { ok: true };
  if (v.kind === "choice") res.selected = v.actual;
  else if (v.actual === "" && wanted && !params.submit && outcome.effect?.page?.valueChanges === undefined) {
    // Token/chip inputs move the typed text into a chip and empty the field: look for it next to the field.
    const target = params.element ? { locator: await resolveElement(page, params.element).catch(() => null) } : params.ref ? await referencesFor(page).resolve(params.ref) : params.locator ? await resolveUnique(page, params.locator, params.nth, 1000, params.within).catch(() => null) : null;
    const chip = target && "locator" in target && target.locator
      ? await target.locator.evaluate((el, w) => {
        let box: Element | null = el.parentElement;
        for (let i = 0; box && i < 3; i++, box = box.parentElement) if ((box as HTMLElement).innerText?.includes(w)) return true;
        return false;
      }, wanted).catch(() => false)
      : false;
    res.value = "";
    res.valueMatches = chip;
    if (chip) res.tokenized = true;
    else res.warning = "The field is empty after typing. The page may have consumed the text (token/chip input, instant search) or rejected it.";
  } else if (v.actual === "" && wanted && params.submit) {
    res.value = "";
    res.note = "The field was cleared after submitting (common for search boxes); check effect for the result.";
  } else if (v.actual !== undefined) {
    const matches = normalize(v.actual) === normalize(wanted);
    res.value = v.secret ? `[HIDDEN:${String(v.actual).length}]` : String(v.actual).slice(0, 120);
    res.valueMatches = matches;
    if (!matches) res.warning = "The field holds a different value than requested (reformatted by the page, a token/chip input, or not cleared). Check `value`.";
  }
  res.effect = outcome.effect;
  res.resolvedBy = outcome.resolvedBy;
  res.execution = outcome.execution;
  return res;
}

/** Back/forward in history; Alt+Arrow key presses do not navigate in headless Chrome. */
export async function goHistory(page: Page, direction: "back" | "forward", timeoutMs = 10_000) {
  const before = page.url();
  const response = direction === "back"
    ? await page.goBack({ timeout: timeoutMs, waitUntil: "commit" }).catch(() => null)
    : await page.goForward({ timeout: timeoutMs, waitUntil: "commit" }).catch(() => null);
  await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
  await settle(page, { quietMs: 300, maxMs: 1500 });
  const url = page.url();
  return { ok: url !== before, url, previousUrl: before, status: response?.status(), title: await page.title().catch(() => ""), note: url === before ? `No ${direction} history entry, or it did not navigate.` : undefined };
}
