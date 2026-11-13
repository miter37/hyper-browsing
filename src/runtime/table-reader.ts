import type { Page } from "playwright";

/**
 * Reads data tables: HTML <table> and ARIA grids/tables (role=grid, table, treegrid), including open shadow roots.
 *
 * Grids drawn on a canvas or virtualised for speed often keep their cells in the DOM as zero-size, screen-reader-only
 * elements. They are hidden from sight, not from the page: a cell counts as present unless it is display:none,
 * visibility:hidden, inert or aria-hidden. Element-visibility reads (read_text, list_items) skip such cells, so a
 * table is read here, as rows and columns, with paging and an optional row filter that runs in the page.
 */
export interface TableFilter { column: string; op: ">" | ">=" | "<" | "<=" | "=" | "!=" | "contains"; value: string | number }
export interface TableOptions { query?: string; index?: number; offset?: number; limit?: number; where?: TableFilter[]; columns?: string[]; links?: boolean; maxChars?: number }

const TABLE_SCRIPT = String.raw`(opts) => {
  const ws = /\s+/g;
  // display:contents rows (common in grids) have no box, so checkVisibility() would call them hidden: walk the
  // ancestors for display:none instead (visibility is inherited, so the element's own value is enough).
  const noneCache = new Map();
  const displayNone = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (noneCache.has(el)) return noneCache.get(el);
    const parent = el.parentElement || (el.getRootNode() && el.getRootNode().host) || null;
    const v = getComputedStyle(el).display === 'none' || displayNone(parent);
    noneCache.set(el, v);
    return v;
  };
  const hidden = (el) => {
    if (el.closest('[aria-hidden="true"],[inert],[hidden]')) return true;
    return getComputedStyle(el).visibility === 'hidden' || displayNone(el);
  };
  // innerText when the element is laid out; otherwise the text of its descendants that are not hidden.
  const textOf = (el) => {
    if (el.offsetWidth || el.offsetHeight) return (el.innerText || '').replace(ws, ' ').trim();
    const parts = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) parts.push(c.nodeValue);
        else if (c.nodeType === 1 && !hidden(c)) walk(c);
      }
    };
    walk(el);
    return parts.join(' ').replace(ws, ' ').trim();
  };
  const roots = [document];
  const found = [];
  for (let i = 0; i < roots.length && i < 50; i++) {
    const root = roots[i];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const t of root.querySelectorAll('table, [role=grid], [role=table], [role=treegrid]')) {
      if (t.tagName !== 'TABLE' && t.closest('table')) continue;
      if (hidden(t)) continue;
      found.push(t);
    }
  }
  const CELL = '[role=gridcell],[role=cell],[role=columnheader],[role=rowheader]';
  const shape = (t) => {
    let rows;
    if (t.tagName === 'TABLE') rows = [...t.rows].filter((r) => r.closest('table') === t);
    else rows = [...t.querySelectorAll('[role=row]')].filter((r) => r.parentElement && r.parentElement.closest('[role=grid],[role=table],[role=treegrid]') === t);
    rows = rows.filter((r) => !hidden(r));
    const cellsOf = (r) => {
      const cells = r.tagName === 'TR' ? [...r.cells] : [...r.querySelectorAll(CELL)].filter((c) => c.closest('[role=row]') === r);
      return cells.filter((c) => !hidden(c));
    };
    const isHead = (r) => {
      const cs = cellsOf(r);
      return cs.length > 0 && (r.parentElement?.tagName === 'THEAD' || cs.every((c) => c.tagName === 'TH' || c.getAttribute('role') === 'columnheader'));
    };
    const headRow = rows.find(isHead);
    let columns = headRow ? cellsOf(headRow).map(textOf) : [];
    const body = rows.filter((r) => r !== headRow && !isHead(r));
    return { el: t, rows: body, cellsOf, columns };
  };
  const label = (t) => (t.getAttribute('aria-label') || t.querySelector('caption')?.innerText || '').replace(ws, ' ').trim().slice(0, 80);
  let tables = found.map(shape).filter((s) => s.rows.length > 0);
  // Layout tables (one column, or a table only holding other tables) are not data.
  tables = tables.filter((s) => s.rows.some((r) => s.cellsOf(r).length > 1));
  if (!tables.length) return { found: false, reason: 'no_table', hint: 'No data table or grid on this page. For a list of cards use list_items; for data the page loaded use page_data.' };
  const summary = tables.map((s, i) => ({ index: i, rows: s.rows.length, columns: s.columns.slice(0, 10), label: label(s.el) || undefined }));
  let pick;
  if (Number.isInteger(opts.index)) pick = tables[opts.index];
  else if (opts.query) {
    const q = opts.query.toLowerCase();
    pick = tables.find((s) => s.columns.some((c) => c.toLowerCase().includes(q)) || label(s.el).toLowerCase().includes(q))
      || tables.find((s) => textOf(s.el).toLowerCase().includes(q));
  } else pick = tables.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!pick) return { found: false, reason: 'no_match', tables: summary.slice(0, 12), hint: 'No table matches; pick one by index.' };

  const width = Math.max(pick.columns.length, ...pick.rows.slice(0, 50).map((r) => pick.cellsOf(r).length));
  const columns = Array.from({ length: width }, (_, i) => pick.columns[i] || 'col' + (i + 1));
  const colIndex = (name) => {
    const n = String(name).toLowerCase();
    let i = columns.findIndex((c) => c.toLowerCase() === n);
    if (i < 0) i = columns.findIndex((c) => c.toLowerCase().includes(n));
    return i;
  };
  const num = (v) => {
    let s = String(v).trim().replace(/[$€£¥₩,\s]/g, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    const m = s.match(/^([+-]?\d*\.?\d+)(%|[kKmMbBtT])?$/);
    if (!m) return NaN;
    const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] || '').toLowerCase()] || 1;
    return (neg ? -1 : 1) * Number(m[1]) * mult;
  };
  const filters = (opts.where || []).map((f) => ({ ...f, i: colIndex(f.column) }));
  const missing = filters.filter((f) => f.i < 0).map((f) => f.column);
  if (missing.length) return { found: true, ok: false, reason: 'unknown_column', missing, columns, hint: 'Filter on one of columns.' };
  const pass = (vals) => filters.every((f) => {
    const v = vals[f.i] ?? '';
    if (f.op === 'contains') return v.toLowerCase().includes(String(f.value).toLowerCase());
    const a = num(v), b = typeof f.value === 'number' ? f.value : num(f.value);
    if (f.op === '=' || f.op === '!=') {
      const eq = !Number.isNaN(a) && !Number.isNaN(b) ? a === b : v.toLowerCase() === String(f.value).toLowerCase();
      return f.op === '=' ? eq : !eq;
    }
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return f.op === '>' ? a > b : f.op === '>=' ? a >= b : f.op === '<' ? a < b : a <= b;
  });
  const keep = opts.columns && opts.columns.length ? opts.columns.map(colIndex).filter((i) => i >= 0) : columns.map((_, i) => i);
  const matched = [];
  for (const r of pick.rows) {
    const cells = pick.cellsOf(r);
    const vals = cells.map((c) => textOf(c).replace(/\t/g, ' '));
    if (!pass(vals)) continue;
    const row = keep.map((i) => vals[i] ?? '');
    if (opts.links) {
      const a = r.querySelector('a[href]');
      row.push(a ? a.href : '');
    }
    matched.push(row);
  }
  // Unnamed columns that are empty in every row (selection boxes, icons) only cost tokens.
  let names = [...keep.map((i) => columns[i]), ...(opts.links ? ['link'] : [])];
  const drop = new Set(names.map((n, j) => (/^col\d+$/.test(n) && matched.every((r) => !r[j]) ? j : -1)).filter((j) => j >= 0));
  if (drop.size) {
    names = names.filter((_, j) => !drop.has(j));
    for (let k = 0; k < matched.length; k++) matched[k] = matched[k].filter((_, j) => !drop.has(j));
  }
  const offset = Math.max(0, opts.offset || 0);
  const limit = Math.max(1, Math.min(opts.limit || 50, 500));
  const budget = Math.max(2000, Math.min(opts.maxChars || 15000, 40000));
  const header = names.join('\t');
  const lines = [];
  let size = header.length, i = offset;
  for (; i < matched.length && lines.length < limit; i++) {
    const line = matched[i].join('\t');
    if (lines.length && size + line.length + 1 > budget) break;
    lines.push(line); size += line.length + 1;
  }
  return {
    found: true,
    table: { index: tables.indexOf(pick), label: label(pick.el) || undefined, totalRows: pick.rows.length },
    matchedRows: matched.length,
    offset, returned: lines.length,
    nextOffset: i < matched.length ? i : undefined,
    format: 'tsv: first line is the header, one row per line, tab-separated',
    tsv: [header, ...lines].join('\n'),
    otherTables: tables.length > 1 ? summary.filter((s) => s.index !== tables.indexOf(pick)).slice(0, 6) : undefined,
  };
}`;

export async function readTable(page: Page, options: TableOptions = {}) {
  return page.evaluate(`(${TABLE_SCRIPT})(${JSON.stringify(options)})`);
}
