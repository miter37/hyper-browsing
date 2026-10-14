import type { Page, ElementHandle, JSHandle, Locator } from "playwright";
import type { SnapshotElement } from "./snapshot";
import type { LocatorStrategy } from "../schema/site";

export type ActionTarget = Pick<Locator, "evaluate" | "click" | "hover" | "fill" | "press" | "selectOption" | "inputValue" | "getAttribute" | "innerText" | "scrollIntoViewIfNeeded" | "isVisible" | "count">;
export const REFERENCE_GUARD = `(el) => {
  const clean = value => (value || '').replace(/\\s+/g, ' ').trim().slice(0,240);
  const labelled = node => (node.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean).map(id => clean(node.getRootNode().getElementById?.(id)?.textContent));
  const context = [];
  for (let parent = el.parentElement, depth = 0; parent && depth < 5 && parent.tagName !== 'BODY'; parent = parent.parentElement, depth++) {
    const heading = parent.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
    context.push({id:parent.id,key:parent.getAttribute('data-key'),item:parent.getAttribute('data-id'),name:parent.getAttribute('aria-label'),labelled:labelled(parent),heading:clean(heading?.textContent)});
  }
  return JSON.stringify({tag:el.tagName,id:el.id,item:el.getAttribute('data-id'),key:el.getAttribute('data-key'),role:el.getAttribute('role'),name:el.getAttribute('aria-label'),labelled:labelled(el),href:el.getAttribute('href'),testId:el.getAttribute('data-testid'),placeholder:el.getAttribute('placeholder'),type:el.getAttribute('type'),text:/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)?null:clean(el.textContent),label:clean(el.labels?.[0]?.textContent),context});
}`;
let nextBlock = 1;
const stores = new WeakMap<Page, ElementReferences>();
export function normalizeReference(ref: string): string { return /^@?e\d+$/.test(ref) ? ref.replace(/^@/, '') : ref; }

export function targetFor(handle: ElementHandle<HTMLElement | SVGElement>): ActionTarget {
  return {
    evaluate: handle.evaluate.bind(handle), click: handle.click.bind(handle), hover: handle.hover.bind(handle),
    fill: handle.fill.bind(handle), press: handle.press.bind(handle), selectOption: handle.selectOption.bind(handle),
    inputValue: handle.inputValue.bind(handle), getAttribute: handle.getAttribute.bind(handle), innerText: handle.innerText.bind(handle),
    scrollIntoViewIfNeeded: handle.scrollIntoViewIfNeeded.bind(handle), isVisible: handle.isVisible.bind(handle),
    count: async () => await handle.evaluate(el => el.isConnected).catch(() => false) ? 1 : 0,
  };
}

export class ElementReferences {
  private state?: JSHandle;
  private generation = 0;
  private entries = new Map<string, { handle: ElementHandle<HTMLElement | SVGElement>; guard: string; metadata: SnapshotElement }>();
  constructor(private page: Page) {
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) this.invalidate(); });
    page.on("close", () => this.invalidate());
  }
  private invalidate() {
    this.generation++;
    for (const entry of this.entries.values()) void entry.handle.dispose().catch(() => {});
    this.entries.clear();
    if (this.state) void this.state.dispose().catch(() => {});
    this.state = undefined;
  }
  async snapshotState() {
    const generation = this.generation;
    if (!this.state) {
      const base = nextBlock; nextBlock += 1_000_000;
      const state = await this.page.evaluateHandle(base => ({ ids: new WeakMap(), next: base, max: base + 999999 }), base);
      if (generation !== this.generation) { await state.dispose(); throw new Error("Snapshot document changed; observe again"); }
      this.state = state;
    }
    return { state: this.state, generation };
  }
  retain(ref: string, handle: ElementHandle<HTMLElement | SVGElement>, guard: string, metadata: SnapshotElement, generation: number) {
    ref = normalizeReference(ref);
    if (generation !== this.generation) { void handle.dispose(); return; }
    const old = this.entries.get(ref);
    if (old) void old.handle.dispose().catch(() => {});
    this.entries.delete(ref);
    this.entries.set(ref, { handle, guard, metadata });
    // Bound live handles without recycling IDs or resolving evicted references heuristically.
    while (this.entries.size > 1200) {
      const oldest = this.entries.keys().next().value!;
      void this.entries.get(oldest)!.handle.dispose().catch(() => {}); this.entries.delete(oldest);
    }
  }
  metadata(ref: string): SnapshotElement | undefined { return this.entries.get(normalizeReference(ref))?.metadata; }
  semanticLocator(ref: string): LocatorStrategy | undefined {
    const e = this.metadata(ref); if (!e) return undefined;
    const scope = e.context ? { within: e.context } : {};
    if (e.testId) return { testId: e.testId, ...scope };
    if (e.role && e.name) return { role: e.role, name: e.name, exact: true, ...scope };
    if (e.placeholder) return { placeholder: e.placeholder, exact: true, ...scope };
    if (e.label) return { label: e.label, exact: true, ...scope };
    if (e.name) return { text: e.name, exact: true, ...scope };
    return undefined;
  }
  async resolve(ref: string): Promise<{ locator: ActionTarget; resolvedBy: "reference" } | { ok: false; reason: "stale_ref"; execution: "not_started"; hint: string }> {
    ref = normalizeReference(ref);
    const entry = this.entries.get(ref);
    const stale = { ok: false as const, reason: "stale_ref" as const, execution: "not_started" as const, hint: "The observed element is no longer valid. Take a fresh snapshot; do not substitute a similar element." };
    if (!entry) return stale;
    const valid = await entry.handle.evaluate((el, guard) => el.isConnected ? eval(`(${guard})`)(el) : null, REFERENCE_GUARD).catch(() => null);
    if (valid !== entry.guard) { this.entries.delete(ref); await entry.handle.dispose().catch(() => {}); return stale; }
    return { locator: targetFor(entry.handle), resolvedBy: "reference" };
  }
}
export function referencesFor(page: Page) {
  let store = stores.get(page);
  if (!store) { store = new ElementReferences(page); stores.set(page, store); }
  return store;
}
