/** HWM view syntax only. It never interprets page text as commands or site semantics. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Attributes = Record<string, Json>;
export interface Primary { value: string; source: string | null }
export interface Relation { rel: string; target: string; basis: 'html' | 'aria' | 'geometry' | 'derived'; qualifiers: Attributes }
export interface NodeLine { type: 'node'; id: string; kind: string; parent: string | null; depth: number; primary?: Primary; attrs: Attributes; relations: Relation[] }
export interface BlockItem { ref: string; literal: boolean; primary?: Primary; attrs: Attributes }
export interface RecordLine { type: 'record'; tag: string; id: string; attrs: Attributes; items: BlockItem[] }
export interface HwmView { observation: string; header: Attributes; entries: (NodeLine | RecordLine)[]; end: 'complete' | 'truncated' | null }
export interface Issue { code: string; id?: string; message: string }
export interface ValidationContext { /** Trusted mapping supplied by the observation store, not by page content. */ foldedTargets?: Record<string, string> }

const ID = /^[A-Za-z][A-Za-z0-9_.-]*/;
const TAGS = new Set(['result','state','outline','edge','candidates','links','gap','change']);
const BLOCKS = new Set(['state','outline','candidates','links']);
const KINDS = new Set(['document','frame','shadow','region','heading','paragraph','text','list','item','table','row','cell','form','fieldset','group','dialog','link','control','image','figure','media']);
const SOURCES = new Set(['aria-label','labelledby','native-label','contents','alt','title','placeholder','dom-text','rendered-text','attribute','ocr']);
const TEXT = new Set(['text','paragraph','heading']);
const RELATIONS: Record<Relation['basis'], Set<string>> = {
  html: new Set(['labels','form','submits','header-for','caption-for','fragment-target','slotted-into']),
  aria: new Set(['labels','describes','controls','owns']),
  geometry: new Set(['above','below','left-of','right-of','overlaps','covered-by']),
  derived: new Set(['section','section-heading']),
};

/** Small JSON scanner: consumes one value, including whitespace, and rejects duplicate keys. */
class Cursor {
  pos = 0;
  constructor(readonly input: string) {}
  fail(message: string): never { throw new Error(`HWM column ${this.pos + 1}: ${message}`); }
  ws() { while (this.input[this.pos] === ' ') this.pos++; }
  id(): string { const m = this.input.slice(this.pos).match(ID); if (!m) this.fail('identifier expected'); this.pos += m[0].length; return m[0]; }
  json(): Json {
    this.ws(); const c = this.input[this.pos];
    if (c === '"') {
      const start = this.pos++; let escaped = false;
      while (this.pos < this.input.length) {
        const ch = this.input[this.pos++];
        if (!escaped && ch === '"') return JSON.parse(this.input.slice(start, this.pos));
        if (!escaped && ch === '\\') escaped = true; else escaped = false;
      }
      this.fail('unterminated JSON string');
    }
    if (c === '[' || c === '{') {
      const array = c === '['; this.pos++; this.ws(); const close = array ? ']' : '}';
      const values: Json[] = []; const object: Record<string, Json> = Object.create(null); const keys = new Set<string>();
      if (this.input[this.pos] === close) { this.pos++; return array ? values : {}; }
      while (this.pos < this.input.length) {
        if (array) values.push(this.json());
        else {
          if (this.input[this.pos] !== '"') this.fail('JSON object key expected');
          const key = this.json() as string; if (keys.has(key)) this.fail(`duplicate JSON key ${key}`); keys.add(key);
          this.ws(); if (this.input[this.pos++] !== ':') this.fail('colon expected'); object[key] = this.json();
        }
        this.ws(); const sep = this.input[this.pos++];
        if (sep === close) return array ? values : Object.fromEntries(Object.entries(object));
        if (sep !== ',') this.fail('JSON comma expected'); this.ws();
      }
      this.fail('unterminated JSON container');
    }
    const primitive = this.input.slice(this.pos).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!primitive) this.fail('JSON value expected');
    this.pos += primitive[0].length; const value = JSON.parse(primitive[0]);
    if (typeof value === 'number' && !Number.isFinite(value)) this.fail('nonfinite number'); return value;
  }
  primary(defaultSource: string): Primary | undefined {
    if (this.input[this.pos] !== '"') return undefined;
    const value = this.json() as string; let source: string | null = defaultSource;
    if (this.input[this.pos] === '@') {
      this.pos++; if (this.input[this.pos] === '?') { source = null; this.pos++; }
      else { source = this.id(); if (!SOURCES.has(source)) this.fail('unknown source'); }
    }
    return { value, source };
  }
  tail(allowRelations = false): { attrs: Attributes; relations: Relation[] } {
    const attrs: Attributes = {}; const relations: Relation[] = []; const keys = new Set<string>();
    while (this.pos < this.input.length) {
      if (this.input[this.pos] !== ' ') this.fail('space expected'); this.ws(); if (this.pos === this.input.length) break;
      const ch = this.input[this.pos];
      if (allowRelations && (ch === '~' || ch === '^' || this.input.startsWith('->', this.pos))) {
        const sigil = ch === '-' ? '->' : ch; this.pos += sigil.length; const rel = this.id();
        if (this.input[this.pos++] !== ':') this.fail('relation colon expected'); const target = this.id();
        let basis: Relation['basis'] = sigil === '->' ? 'html' : sigil === '~' ? 'geometry' : 'derived';
        if (this.input.startsWith('@aria', this.pos)) { if (sigil !== '->') this.fail('ARIA suffix on nonexplicit relation'); this.pos += 5; basis = 'aria'; }
        let qualifiers: Attributes = {};
        if (this.input[this.pos] === '{') qualifiers = this.json() as Attributes;
        if (!RELATIONS[basis].has(rel)) this.fail(`invalid ${basis} relation ${rel}`);
        relations.push({ rel, target, basis, qualifiers });
      } else {
        const key = this.id(); if (this.input[this.pos++] !== '=') this.fail('attribute equals expected');
        if (keys.has(key)) this.fail(`duplicate attribute ${key}`); keys.add(key); attrs[key] = this.json();
      }
    }
    return { attrs, relations };
  }
}

export function parseHwm(source: string): HwmView {
  const lines = source.replace(/\r\n/g, '\n').split('\n'); if (lines.at(-1) === '') lines.pop();
  const head = new Cursor(lines.shift() ?? '');
  if (!head.input.startsWith('@hwm ')) head.fail('header expected'); head.pos = 5;
  const observation = head.id(); const header = head.tail().attrs;
  const view: HwmView = { observation, header, entries: [], end: null }; const stack: string[] = [];
  let block: RecordLine | undefined;
  for (const line of lines) {
    if (view.end) throw new Error('HWM content after end');
    if (line.includes('\t') || line.trim() === '') throw new Error('HWM tabs/empty lines not allowed');
    const pad = line.match(/^ */)![0].length; if (pad % 2) throw new Error('HWM odd indentation');
    const cur = new Cursor(line); cur.pos = pad;
    if (line.slice(pad).startsWith('- ')) {
      if (!block || !BLOCKS.has(block.tag)) cur.fail('block item without block'); cur.pos += 2;
      const literal = line[cur.pos] === '"'; const ref = literal ? cur.json() as string : cur.id();
      const saved = cur.pos; cur.ws(); const primary = cur.primary('dom-text'); if (!primary) cur.pos = saved;
      const { attrs } = cur.tail(); block!.items.push({ ref, literal, ...(primary ? { primary } : {}), attrs }); continue;
    }
    block = undefined;
    if (line.startsWith('@end ')) {
      const match = line.match(/^@end ([A-Za-z][A-Za-z0-9_.-]*) (complete|truncated)$/);
      if (!match || match[1] !== observation) cur.fail('invalid end'); view.end = match![2] as 'complete' | 'truncated'; continue;
    }
    if (line[cur.pos] === '@') {
      if (pad) cur.fail('record indentation must be zero'); cur.pos++; const tag = cur.id();
      if (!TAGS.has(tag)) cur.fail('unknown record'); if (line[cur.pos++] !== ' ') cur.fail('record ID expected');
      const id = cur.id(); const { attrs } = cur.tail();
      const record: RecordLine = { type: 'record', tag, id, attrs, items: [] }; view.entries.push(record); if (BLOCKS.has(tag)) block = record; continue;
    }
    const depth = pad / 2; if (depth > stack.length) cur.fail('indentation skips parent');
    const id = cur.id(); if (line[cur.pos++] !== ' ') cur.fail('kind expected'); const kind = cur.id(); if (!KINDS.has(kind)) cur.fail('unknown kind');
    const saved = cur.pos; cur.ws(); const primary = cur.primary(TEXT.has(kind) ? 'dom-text' : 'contents'); if (!primary) cur.pos = saved;
    const { attrs, relations } = cur.tail(true);
    view.entries.push({ type: 'node', id, kind, parent: depth ? stack[depth - 1] : null, depth, ...(primary ? { primary } : {}), attrs, relations });
    stack.length = depth; stack.push(id);
  }
  return view;
}

function ordered(value: Json): Json {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])]));
  return value;
}
function attributes(attrs: Attributes): string { return Object.keys(attrs).sort().map(k => ` ${k}=${JSON.stringify(ordered(attrs[k]))}`).join(''); }
function primaryText(primary: Primary | undefined, defaultSource: string): string {
  if (!primary) return ''; return ` ${JSON.stringify(primary.value)}${primary.source === null ? '@?' : primary.source === defaultSource ? '' : '@' + primary.source}`;
}
export function serializeHwm(view: HwmView): string {
  const lines = [`@hwm ${view.observation}${attributes(view.header)}`];
  for (const entry of view.entries) {
    if (entry.type === 'node') {
      const relations = entry.relations.map(r => ` ${r.basis === 'html' || r.basis === 'aria' ? '->' : r.basis === 'geometry' ? '~' : '^'}${r.rel}:${r.target}${r.basis === 'aria' ? '@aria' : ''}${Object.keys(r.qualifiers).length ? JSON.stringify(ordered(r.qualifiers)) : ''}`).join('');
      lines.push(`${'  '.repeat(entry.depth)}${entry.id} ${entry.kind}${primaryText(entry.primary, TEXT.has(entry.kind) ? 'dom-text' : 'contents')}${attributes(entry.attrs)}${relations}`);
    } else {
      lines.push(`@${entry.tag} ${entry.id}${attributes(entry.attrs)}`);
      for (const item of entry.items) lines.push(`- ${item.literal ? JSON.stringify(item.ref) : item.ref}${primaryText(item.primary, 'dom-text')}${attributes(item.attrs)}`);
    }
  }
  if (view.end) lines.push(`@end ${view.observation} ${view.end}`);
  return lines.join('\n') + '\n';
}

export function validateHwm(view: HwmView, context: ValidationContext = {}): Issue[] {
  const issues: Issue[] = []; const issue = (code: string, message: string, id?: string) => issues.push({ code, message, ...(id ? { id } : {}) });
  if (view.end !== 'complete') issue(view.end ? 'truncated' : 'missing_end', 'Output is incomplete');
  for (const key of ['version','session','document','url','view','captured-at','scan','collected']) if (!(key in view.header)) issue('header', `Missing ${key}`);
  if (view.header.version !== '0.2') issue('version','Unsupported version');
  if (!['overview','focus','full'].includes(String(view.header.view))) issue('header','Invalid view mode');
  const scan = view.header.scan;
  if (!scan || typeof scan !== 'object' || Array.isArray(scan) || typeof scan.scope !== 'string' || typeof scan.complete !== 'boolean') issue('header','Invalid scan scope/completeness');
  if (!Array.isArray(view.header.collected) || view.header.collected.some(x => typeof x !== 'string')) issue('header','Invalid collected fields');
  for (const key of ['session','document','url']) if (typeof view.header[key] !== 'string') issue('header',`Invalid ${key}`);
  if (typeof view.header['captured-at'] !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(view.header['captured-at']) || !Number.isFinite(Date.parse(view.header['captured-at']))) issue('header','Invalid observation time');
  const ids = new Set<string>(); const nodes = new Map<string, NodeLine>(); const gaps = new Map<string, RecordLine>();
  for (const entry of view.entries) {
    if (ids.has(entry.id)) issue('duplicate_id','ID repeated',entry.id); ids.add(entry.id);
    if (entry.type === 'node') nodes.set(entry.id,entry); else if (entry.tag === 'gap') gaps.set(entry.id,entry);
  }
  const allNodes = [...nodes.values()];
  if (allNodes[0]?.kind !== 'document' || allNodes[0]?.parent !== null || allNodes.filter(n => n.parent === null).length !== 1) issue('root','Expected a single document root');
  const target = (ref: Json | undefined, owner: string) => {
    if (typeof ref !== 'string') { issue('reference','Node reference must be a string',owner); return; }
    if (nodes.has(ref)) return;
    const gap = gaps.get(context.foldedTargets?.[ref] ?? '');
    if (gap?.attrs.kind !== 'folded' && !(gap?.attrs.kind==='unavailable'&&gap.attrs.collected===true)) issue('missing_target',`Unresolved node ${ref}`,owner);
  };
  const listTargets = (refs: Json | undefined, owner: string) => { if (Array.isArray(refs)) refs.forEach(ref => target(ref,owner)); };
  const address = (value: Json | undefined, owner: string) => {
    if (!value || Array.isArray(value) || typeof value !== 'object' || typeof value.obs !== 'string' || typeof value.node !== 'string') { issue('change_address','Expected observation and node',owner); return; }
    if (value.obs === view.observation) target(value.node,owner);
  };
  let rank = 0; const order: Record<string, number> = { result:1,state:2,outline:3,edge:5,candidates:6,links:7,change:9 };
  for (const entry of view.entries) {
    if (entry.type === 'node') {
      if (rank > 4) issue('order','Node after trailing records',entry.id); rank = Math.max(rank,4);
      if (entry.parent !== null) target(entry.parent,entry.id);
      const parents = new Set([entry.id]); let parent = entry.parent;
      while (parent !== null && nodes.has(parent)) {
        if (parents.has(parent)) { issue('parent_cycle','Parent graph contains a cycle',entry.id); break; }
        parents.add(parent); parent = nodes.get(parent)!.parent;
      }
      if (entry.kind === 'heading' && entry.attrs.level!==null && (!Number.isInteger(entry.attrs.level) || Number(entry.attrs.level) < 1)) issue('heading_level','Heading level required (positive integer or explicit null)',entry.id);
      if (TEXT.has(entry.kind) && !entry.primary && !(entry.kind !== 'text' && entry.attrs.content === 'children')) issue('primary','Text primary or explicit child content required',entry.id);
      const sourceKey = TEXT.has(entry.kind) ? 'text-source' : 'name-source';
      if (entry.primary && entry.primary.source !== null && (entry.attrs[sourceKey] === null || Array.isArray(entry.attrs.uncollected) && entry.attrs.uncollected.includes(sourceKey))) issue('source','Source uncertainty conflicts with primary suffix',entry.id);
      if (Array.isArray(entry.attrs.selected)) { listTargets(entry.attrs.selected,entry.id); if (typeof entry.attrs['selected-complete'] !== 'boolean') issue('selected_complete','Selection completeness required',entry.id); }
      for (const rel of entry.relations) { target(rel.target,entry.id); if (rel.rel === 'covered-by' && typeof rel.qualifiers.test !== 'string') issue('hit_test','Hit test scope required',entry.id); }
      continue;
    }
    const next = order[entry.tag]; if (next && next < rank) issue('order','Records out of order',entry.id); if (next) rank = next;
    const a = entry.attrs;
    if (entry.tag === 'edge') {
      target(a.from,entry.id); target(a.to,entry.id);
      if (!(String(a.basis) in RELATIONS) || !RELATIONS[a.basis as Relation['basis']]?.has(String(a.rel))) issue('relation','Invalid edge relation/basis',entry.id);
    }
    if (entry.tag === 'gap') {
      if (!['folded','unobserved','unavailable','redacted'].includes(String(a.kind))) issue('gap','Invalid gap kind',entry.id);
      if (typeof a.reason !== 'string') issue('gap','Gap reason required',entry.id);
      if (a.parent !== undefined) target(a.parent,entry.id); if (a.node !== undefined) target(a.node,entry.id);
    }
    if (entry.tag === 'candidates' && a.scope !== undefined) target(a.scope,entry.id);
    if (entry.tag === 'result' && !['not_started','completed','partial','outcome_unknown'].includes(String(a.execution))) issue('execution','Invalid execution status',entry.id);
    for (const item of entry.items) {
      if (!item.literal && item.ref !== 'url') target(item.ref,entry.id);
      for (const field of ['refs','selected','parts','source-nodes']) listTargets(item.attrs[field],entry.id);
      if(Array.isArray(item.attrs.selected)&&typeof item.attrs['selected-complete']!=='boolean')issue('selected_complete','State selection completeness required',entry.id);
      if (item.attrs.form !== undefined) target(item.attrs.form,entry.id);
      if (entry.tag === 'links' && item.attrs['refs-complete'] === true) {
        const total = item.attrs.total;
        const count = typeof total === 'number' ? total : total && typeof total === 'object' && !Array.isArray(total) && total.exact === true ? total.min : undefined;
        if (!Array.isArray(item.attrs.refs) || count !== item.attrs.refs.length) issue('links_count','Complete reference list does not match exact total',entry.id);
      }
    }
    if (entry.tag === 'change') {
      const op = a.op;
      const changeAddress=(value:Json|undefined)=>{
        if(a.subject!=='session'){address(value,entry.id);return;}
        if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.session!=='string')issue('change_address','Session change requires a session address',entry.id);
      };
      if (!['changed','added','removed','unchanged','incomparable'].includes(String(op))) { issue('change','Invalid change operation',entry.id); continue; }
      if (op === 'changed' || op === 'unchanged' || op === 'removed') changeAddress(a.before);
      if (op === 'changed' || op === 'unchanged' || op === 'added') changeAddress(a.after);
      if ((op === 'changed' || op === 'unchanged') && typeof a.field !== 'string') issue('change','Field required',entry.id);
      if (op === 'changed' && (typeof a.identity !== 'string' || !('old' in a) || !('new' in a))) issue('change','Identity and compared values required',entry.id);
      if (op === 'incomparable' && typeof a.reason !== 'string') issue('change','Incomparable reason required',entry.id);
      if(op==='incomparable'){if(a.before!==undefined)changeAddress(a.before);if(a.after!==undefined)changeAddress(a.after);}
      if(op==='unchanged'&&typeof a.identity!=='string')issue('change','Unchanged requires identity evidence',entry.id);
      if (op === 'added' && a.before !== undefined || op === 'removed' && a.after !== undefined) issue('change','Wrong-side address',entry.id);
    }
  }
  return issues;
}
