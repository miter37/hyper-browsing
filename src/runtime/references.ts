import type { Page, ElementHandle, JSHandle, Locator } from "playwright";
import type { SnapshotElement } from "./snapshot";
import type { LocatorStrategy } from "../schema/site";
import { randomBytes, randomUUID } from "node:crypto";

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
// Opaque decimal epoch preserves e<digits> CLI compatibility. Never convert a ref to Number.
// 128 random bits separate process instances; fixed widths make concatenation unambiguous.
const referenceEpoch = BigInt('0x' + randomBytes(16).toString('hex')).toString().padStart(39, '0');
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
  private readonly pageIdentity = randomUUID().replace(/-/g,'');
  private state?: JSHandle;
  private generation = 0;
  private locationGeneration=0;
  private navigationBarrier:Promise<void>=Promise.resolve();
  private entries = new Map<string, { handle?: ElementHandle<HTMLElement | SVGElement>; guard: string; metadata: SnapshotElement }>();
  private pendingDisposals=new Set<Promise<void>>();
  private disposalSettled=0;
  private disposalFailed=0;
  private lastInvalidation?:{reason:string;attempted:number;complete:boolean;elapsedMs:number|null};
  diagnostics(){return {source:'host-registered-references' as const,registeredReferences:this.entries.size,boundHandles:[...this.entries.values()].filter(e=>e.handle).length,pendingDisposals:this.pendingDisposals.size,disposalSettled:this.disposalSettled,disposalFailed:this.disposalFailed,...(this.lastInvalidation?{lastInvalidation:{...this.lastInvalidation}}:{})};}
  private dispose(handle:JSHandle):Promise<void>{
    const pending=handle.dispose().catch(()=>{this.disposalFailed++;}).finally(()=>{this.disposalSettled++;this.pendingDisposals.delete(pending);});
    this.pendingDisposals.add(pending);return pending;
  }
  documentIdentity(): string { return `d${this.pageIdentity}_${this.generation}`; }
  constructor(private page: Page) {
    page.on("framenavigated", frame => {
      if(frame!==page.mainFrame())return;
      this.locationGeneration++;
      const state=this.state;
      if(!state){this.invalidate('navigation');return;}
      this.navigationBarrier=this.navigationBarrier.then(async()=>{
        if(this.state!==state)return;
        const same=await state.evaluate((s:any)=>s.document===document).catch(()=>false);
        if(!same&&this.state===state)this.invalidate('navigation');
      });
    });
    page.on("close", () => this.invalidate('close'));
  }
  private invalidate(reason:string) {
    const started=performance.now(),pending:Promise<void>[]=[];
    this.generation++;
    for (const entry of this.entries.values()) if(entry.handle)pending.push(this.dispose(entry.handle));
    this.entries.clear();
    if (this.state) pending.push(this.dispose(this.state));
    this.state = undefined;
    const event={reason,attempted:pending.length,complete:false,elapsedMs:null as number|null};this.lastInvalidation=event;
    void Promise.all(pending).then(()=>{event.complete=true;event.elapsedMs=performance.now()-started;});
  }
  async snapshotState() {
    await this.settleNavigation();
    const generation = this.generation;
    if (!this.state) {
      const base = nextBlock; nextBlock += 1_000_000;
      if (!Number.isSafeInteger(base + 999999)) throw new Error('Reference block capacity reached');
      const state = await this.page.evaluateHandle(({ base, epoch }) => ({ document, ids: new WeakMap(), targets:new Map(), next: base, max: base + 999999, epoch, observedIds: new WeakMap(), observedTargets:new Map(), observedNext: 1, observedReadIds:new WeakMap(), observedReadNext:1,regionTargets:new Map() }), { base, epoch: referenceEpoch });
      if (generation !== this.generation) { await this.dispose(state); throw new Error("Snapshot document changed; observe again"); }
      this.state = state;
    }
    return { state: this.state, generation };
  }
  retain(ref: string, handle: ElementHandle<HTMLElement | SVGElement>, guard: string, metadata: SnapshotElement, generation: number) {
    ref = normalizeReference(ref);
    if (generation !== this.generation) { void this.dispose(handle); return; }
    const old = this.entries.get(ref);
    if (old?.handle) void this.dispose(old.handle);
    this.entries.delete(ref);
    this.entries.set(ref, { handle, guard, metadata });
    // Bound live handles without recycling IDs or resolving evicted references heuristically.
    while (this.entries.size > 1200) {
      const oldest = this.entries.keys().next().value!;
      const handle=this.entries.get(oldest)!.handle;if(handle)void this.dispose(handle); this.entries.delete(oldest);
    }
  }
  retainMetadata(ref:string,guard:string,metadata:SnapshotElement,generation:number){
    if(generation!==this.generation)return;
    ref=normalizeReference(ref);const old=this.entries.get(ref);if(old?.handle)void this.dispose(old.handle);
    this.entries.delete(ref);this.entries.set(ref,{guard,metadata});
    while(this.entries.size>1200){const id=this.entries.keys().next().value!,entry=this.entries.get(id)!;if(entry.handle)void this.dispose(entry.handle);this.entries.delete(id);}
  }
  metadata(ref: string): SnapshotElement | undefined { return this.entries.get(normalizeReference(ref))?.metadata; }
  async settleNavigation(){await this.navigationBarrier;}
  navigationRevision(){return this.locationGeneration;}
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
    await this.settleNavigation();
    ref = normalizeReference(ref);
    const entry = this.entries.get(ref);
    const stale = { ok: false as const, reason: "stale_ref" as const, execution: "not_started" as const, hint: "The observed element is no longer valid. Take a fresh snapshot; do not substitute a similar element." };
    if (!entry) return stale;
    if(!entry.handle){
      const generation=this.generation,state=this.state;if(!state)return stale;
      const node=await state.evaluateHandle((s:any,id:string)=>s.targets.get(id)?.deref()??null,ref).catch(()=>null);
      const handle=node?.asElement();
      if(!handle||generation!==this.generation||this.entries.get(ref)!==entry){if(node)await this.dispose(node);return stale;}
      entry.handle=handle as ElementHandle<HTMLElement|SVGElement>;
    }
    const valid = await entry.handle.evaluate((el, guard) => el.isConnected ? eval(`(${guard})`)(el) : null, REFERENCE_GUARD).catch(() => null);
    if (valid !== entry.guard) { this.entries.delete(ref); await this.dispose(entry.handle); return stale; }
    return { locator: targetFor(entry.handle), resolvedBy: "reference" };
  }
}
export function referencesFor(page: Page) {
  let store = stores.get(page);
  if (!store) { store = new ElementReferences(page); stores.set(page, store); }
  return store;
}
