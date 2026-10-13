import type { Locator, Page } from "playwright";
import type { ElementDefinition, LocatorStrategy, SiteDefinition } from "../schema/site";

export function locatorFromStrategy(page: Page, strategy: LocatorStrategy): Locator {
  if (strategy.role) return page.getByRole(strategy.role as any, { name: strategy.name, exact: strategy.exact });
  if (strategy.testId) return page.getByTestId(strategy.testId);
  if (strategy.label) return page.getByLabel(strategy.label, { exact: strategy.exact });
  if (strategy.placeholder) return page.getByPlaceholder(strategy.placeholder, { exact: strategy.exact });
  if (strategy.text) return page.getByText(strategy.text, { exact: strategy.exact });
  if (strategy.css) return page.locator(strategy.css);
  throw new Error("Invalid locator strategy");
}

export interface LocatorCandidate {
  nth: number;
  tag: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  href?: string;
  value?: string;
  // Where the element sits: its own card/section heading, else its form, else its landmark (header, nav, dialog...).
  context?: string;
}

export interface Suggestion { tag: string; role?: string; name?: string; use: string }

export type UniqueResolution =
  | { locator: Locator; resolvedBy?: "exact" | "same-href" | "within" | "role-family"; equivalentMatches?: number }
  | { ambiguous: true; count: number; candidates: LocatorCandidate[] }
  | { hiddenOnly: true; hiddenCount: number; alternatives: Suggestion[] }
  | { noMatch: true; suggestions: Suggestion[] };

const MAX_CANDIDATES = 10;
const ROLE_FAMILIES = [["textbox", "searchbox", "combobox"], ["checkbox", "switch", "menuitemcheckbox"], ["radio", "menuitemradio"], ["option", "menuitem"]];
const MAX_DESCRIBED = 50;

// Runs in the page: what an agent needs to tell matches apart. No named inner functions: tsx wraps them in
// `__name`, which does not exist in the page.
const describeCandidate = (el: Element) => {
  const h = el as HTMLElement & { labels?: NodeListOf<HTMLLabelElement>; value?: string; type?: string };
  const [aria, inner, title, placeholder, labelText] = [
    el.getAttribute("aria-label"), h.innerText, el.getAttribute("title"), el.getAttribute("placeholder"),
    h.labels && h.labels[0] ? h.labels[0].textContent : "",
  ].map((s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 80));
  const tag = el.tagName.toLowerCase();
  const inputRoles: Record<string, string> = { checkbox: "checkbox", radio: "radio", search: "searchbox", submit: "button", button: "button" };
  const role = el.getAttribute("role") || (tag === "a" && el.hasAttribute("href") ? "link" : tag === "button" ? "button"
    : tag === "select" ? "combobox" : tag === "textarea" ? "textbox"
    : tag === "input" ? inputRoles[String(h.type)] || "textbox" : undefined);
  const scope: string[] = [];
  let node: Element | null = el.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const headings = node.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]");
    if (!headings.length) continue;
    if (headings.length === 1 && !headings[0].contains(el)) {
      scope.push(((headings[0] as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 80));
    }
    break;
  }
  const form = el.closest("form, fieldset, [role=form], [role=search]");
  if (form) {
    const legend = form.querySelector(":scope > legend");
    scope.push(String(form.getAttribute("aria-label") || (legend && legend.textContent) || form.getAttribute("name") || form.id || form.tagName.toLowerCase()).replace(/\s+/g, " ").trim().slice(0, 60));
  }
  const landmark = el.closest("header, nav, main, footer, aside, dialog, [role=dialog], [role=banner], [role=navigation], [role=main], [role=contentinfo]");
  if (landmark) scope.push(String(landmark.getAttribute("aria-label") || landmark.getAttribute("role") || landmark.tagName.toLowerCase()).trim().slice(0, 60));
  return {
    tag, role, name: aria || inner || title || undefined, label: labelText || undefined, placeholder: placeholder || undefined,
    href: el.getAttribute("href") || undefined,
    value: (tag === "input" || tag === "textarea") && h.type !== "password" && h.value ? String(h.value).slice(0, 60) : undefined,
    scope: scope.filter(Boolean),
  };
};

type Described = ReturnType<typeof describeCandidate>;

function norm(s: string | undefined): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").replace(/[\s:*]+$/, "").trim();
}

function suggestedUse(d: { role?: string; name?: string }): string {
  if (d.role && d.name && d.name.length <= 60) return `--role ${d.role} --name ${JSON.stringify(d.name)} --exact`;
  if (d.name && d.name.length <= 60) return `--text ${JSON.stringify(d.name)} --exact`;
  return "(see snapshot)";
}

/** Visible elements whose text, aria-label or placeholder contains the locator's words, whatever their role. */
async function similarVisible(page: Page, strategy: LocatorStrategy): Promise<Suggestion[]> {
  const words = strategy.name ?? strategy.label ?? strategy.text ?? strategy.placeholder ?? strategy.testId;
  if (!words) return [];
  const pools = [
    page.getByText(words, { exact: false }),
    page.locator(`[aria-label*=${JSON.stringify(words)} i]`),
    page.getByPlaceholder(words, { exact: false }),
  ];
  const out: Suggestion[] = [];
  for (const pool of pools) {
    const vis = pool.filter({ visible: true });
    const n = Math.min(await vis.count().catch(() => 0), 5);
    for (let i = 0; i < n && out.length < 5; i++) {
      const d = await vis.nth(i).evaluate(describeCandidate).catch(() => null);
      if (!d) continue;
      const s = { tag: d.tag, role: d.role, name: d.name };
      if (!out.some((o) => o.tag === s.tag && o.name === s.name && o.role === s.role)) out.push({ ...s, use: suggestedUse(s) });
    }
  }
  return out;
}

/**
 * Resolves an agent-given locator to one visible element.
 * - Several visible matches: if exactly one has exactly the asked name/label/text, take it (a substring match like
 *   "These words" also hits "Not these words"); if all are links to the same href, they are one target; with
 *   `within`, keep the matches whose heading/form/landmark contains it; otherwise refuse with described candidates.
 * - Nothing visible yet: a still-loading list is waited for (then counted again, so it cannot become a silent
 *   first-match click). Only hidden matches -> `hiddenOnly` quickly, with visible look-alikes; none -> `noMatch`
 *   with suggestions, instead of a bare timeout.
 */
export async function resolveUnique(
  page: Page, strategy: LocatorStrategy, nth?: number, timeoutMs = 5000, within?: string,
): Promise<UniqueResolution> {
  const all = locatorFromStrategy(page, strategy);
  const visible = all.filter({ visible: true });
  let count = await visible.count();
  if (count === 0) {
    const hiddenNow = await all.count().catch(() => 0);
    // Hidden matches only get a short grace period (a menu still animating open); a missing one gets the full wait.
    const wait = hiddenNow > 0 ? Math.min(timeoutMs, 1500) : timeoutMs;
    const appeared = await visible.first().waitFor({ state: "visible", timeout: wait }).then(() => true).catch(() => false);
    if (appeared) {
      await page.waitForTimeout(400);
      count = await visible.count();
    } else {
      const hiddenCount = await all.count().catch(() => 0);
      // Text fields switch role while their suggestion list opens (searchbox -> combobox): try the sibling roles.
      const family = ROLE_FAMILIES.find((f) => f.includes(String(strategy.role)));
      if (family && hiddenCount === 0) {
        for (const role of family.filter((r) => r !== strategy.role)) {
          const alt = page.getByRole(role as any, { name: strategy.name, exact: strategy.exact }).filter({ visible: true });
          if ((await alt.count()) === 1) return { locator: alt.first(), resolvedBy: "role-family" };
        }
      }
      if (hiddenCount > 0) return { hiddenOnly: true, hiddenCount, alternatives: await similarVisible(page, strategy) };
      return { noMatch: true, suggestions: await similarVisible(page, strategy) };
    }
  }

  let indices = [...Array(count).keys()];
  let described: Described[] | undefined;
  const describe = async (): Promise<Described[]> => {
    if (!described) {
      described = [];
      for (let i = 0; i < Math.min(count, MAX_DESCRIBED); i++) {
        described.push(await visible.nth(i).evaluate(describeCandidate).catch(() => ({ tag: "?", scope: [] }) as unknown as Described));
      }
      indices = indices.slice(0, described.length);
    }
    return described;
  };

  if (within) {
    const ds = await describe();
    const w = norm(within);
    indices = indices.filter((i) => ds[i].scope.some((s) => norm(s).includes(w)));
    if (indices.length === 0) return { noMatch: true, suggestions: [] };
    if (nth === undefined && indices.length === 1) return { locator: visible.nth(indices[0]), resolvedBy: "within" };
  }

  if (nth !== undefined) {
    if (!Number.isInteger(nth) || nth < 0 || nth >= indices.length) throw new Error(`--nth ${nth} is out of range: ${indices.length} visible matches`);
    return { locator: visible.nth(indices[nth]) };
  }
  if (indices.length === 1) return { locator: visible.nth(indices[0]) };

  const ds = await describe();
  const wanted = norm(strategy.name ?? strategy.label ?? strategy.text ?? strategy.placeholder);
  if (wanted) {
    const exact = indices.filter((i) => [ds[i].name, ds[i].label, ds[i].placeholder].some((v) => norm(v) === wanted));
    if (exact.length === 1) return { locator: visible.nth(exact[0]), resolvedBy: "exact" };
    if (exact.length > 1) indices = exact;
  }
  const first = ds[indices[0]];
  if (first && first.href && first.href !== "#" && indices.every((i) => ds[i].href === first.href)) {
    return { locator: visible.nth(indices[0]), resolvedBy: "same-href", equivalentMatches: indices.length };
  }

  const candidates: LocatorCandidate[] = indices.slice(0, MAX_CANDIDATES).map((i, k) => {
    const d = ds[i];
    return {
      nth: within ? k : i, tag: d.tag, role: d.role, name: d.name, label: d.label, placeholder: d.placeholder,
      href: d.href, value: d.value, context: d.scope.join(" / ") || undefined,
    };
  });
  return { ambiguous: true, count: within ? indices.length : count, candidates };
}

export async function resolveElement(page: Page, element: ElementDefinition): Promise<Locator> {
  let last: Locator | undefined;
  for (const strategy of element.strategies) {
    const locator = locatorFromStrategy(page, strategy).first();
    last = locator;
    if (await locator.count().catch(() => 0)) return locator;
  }
  if (last) return last;
  throw new Error("Element has no locator strategy");
}

export async function locatorFor(page: Page, site: SiteDefinition, elementId: string): Promise<Locator> {
  const element = site.elements[elementId];
  if (!element) throw new Error(`Unknown element: ${elementId}`);
  return resolveElement(page, element);
}
