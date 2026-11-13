import type { Page, Response } from "playwright";

/**
 * Data the page itself loaded: JSON responses of its fetch/XHR calls (first-party only, so ad and tracker traffic
 * stays out) and JSON embedded in the HTML (script type=application/json, ld+json, __NEXT_DATA__ and the like).
 * Pages that draw their content (canvas, virtual lists, charts) still received it as data; reading that data is
 * often the complete and exact version of what is on screen.
 *
 * Bodies stay in memory with the tab and are never written to disk.
 */
const MAX_ENTRIES = 40;
const MAX_BODY = 2_000_000;
interface Entry { url: string; method: string; status: number; at: string; size: number; body: string }
const recorded = new WeakMap<Page, Entry[]>();

const siteOf = (host: string) => host.split(".").slice(-2).join(".");

export function recordPageData(page: Page) {
  if (recorded.has(page)) return;
  const entries: Entry[] = [];
  recorded.set(page, entries);
  page.on("response", (res: Response) => { void keep(page, res, entries); });
}

async function keep(page: Page, res: Response, entries: Entry[]) {
  try {
    const type = res.request().resourceType();
    if (type !== "xhr" && type !== "fetch") return;
    const ct = res.headers()["content-type"] || "";
    if (!/json/i.test(ct)) return;
    const url = new URL(res.url());
    let pageHost = "";
    try { pageHost = new URL(page.url()).hostname; } catch {}
    if (pageHost && siteOf(url.hostname) !== siteOf(pageHost)) return;
    const len = Number(res.headers()["content-length"] || 0);
    if (len > MAX_BODY) return;
    const body = await res.text();
    if (body.length > MAX_BODY) return;
    entries.push({ url: res.url(), method: res.request().method(), status: res.status(), at: new Date().toISOString(), size: body.length, body });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  } catch {}
}

const EMBEDDED_SCRIPT = String.raw`() => [...document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__, script#__NUXT_DATA__')]
  .map((s, i) => ({ id: s.id || s.getAttribute('data-target') || s.type + '#' + i, text: s.textContent || '' }))
  .filter((s) => s.text.trim().length > 2 && s.text.length < 2000000)`;

function summarize(value: any): any {
  if (Array.isArray(value)) return { type: "array", length: value.length, item: value.length ? summarize(value[0]) : undefined };
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    return { type: "object", keys: keys.slice(0, 25), ...(keys.length > 25 ? { moreKeys: keys.length - 25 } : {}) };
  }
  return { type: typeof value };
}

function pick(value: any, path?: string) {
  if (!path) return value;
  let cur = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : cur[part];
  }
  return cur;
}

/** Without source: the list of what was loaded. With source: that data at path, filtered by text, paged. */
export async function readPageData(page: Page, opts: { source?: string; path?: string; query?: string; offset?: number; limit?: number; maxChars?: number }) {
  const network = recorded.get(page) || [];
  const embedded: Array<{ id: string; text: string }> = await page.evaluate(`(${EMBEDDED_SCRIPT})()`).catch(() => []) as any;
  const all = [
    ...network.map((e, i) => ({ source: `net:${i}`, origin: "network", url: e.url.slice(0, 200), status: e.status, size: e.size, text: e.body })),
    ...embedded.map((e, i) => ({ source: `html:${i}`, origin: "embedded", url: e.id.slice(0, 120), status: 200, size: e.text.length, text: e.text })),
  ];
  if (!opts.source) {
    const q = opts.query?.toLowerCase();
    const list = all.filter((e) => !q || e.url.toLowerCase().includes(q) || e.text.toLowerCase().includes(q)).map((e) => {
      let shape: any; try { shape = summarize(JSON.parse(e.text)); } catch { shape = { type: "text" }; }
      return { source: e.source, origin: e.origin, url: e.url, status: e.status, size: e.size, shape };
    });
    return { found: list.length > 0, sources: list.slice(-30), recordingSince: "the tab was opened by session_open (earlier loads are not recorded)",
      hint: list.length ? "Read one with source (and path such as data.rows, query to keep matching items)." : "Nothing loaded as JSON yet. Reload or act on the page, then look again; or read the page with read_table/read_text." };
  }
  const entry = all.find((e) => e.source === opts.source);
  if (!entry) return { found: false, reason: "no_source", hint: "Use a source from page_data without source." };
  let data: any;
  try { data = pick(JSON.parse(entry.text), opts.path); } catch { data = entry.text; }
  if (data === undefined) return { found: false, reason: "no_path", hint: "path did not match; see shape in the source list." };
  let items: any[] | undefined = Array.isArray(data) ? data : undefined;
  if (items && opts.query) { const q = opts.query.toLowerCase(); items = items.filter((x) => JSON.stringify(x).toLowerCase().includes(q)); }
  const budget = Math.max(2000, Math.min(opts.maxChars || 15000, 40000));
  if (items) {
    const offset = Math.max(0, opts.offset || 0), limit = Math.max(1, Math.min(opts.limit || 50, 500));
    const out: any[] = []; let size = 0, i = offset;
    for (; i < items.length && out.length < limit; i++) {
      const s = JSON.stringify(items[i]);
      if (out.length && size + s.length > budget) break;
      out.push(items[i]); size += s.length;
    }
    return { found: true, source: entry.source, url: entry.url, total: items.length, offset, returned: out.length, nextOffset: i < items.length ? i : undefined, items: out };
  }
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const offset = Math.max(0, opts.offset || 0);
  const chunk = text.slice(offset, offset + budget);
  return { found: true, source: entry.source, url: entry.url, shape: summarize(data), length: text.length, offset,
    nextOffset: offset + chunk.length < text.length ? offset + chunk.length : undefined, value: chunk };
}
