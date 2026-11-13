import type { Page } from "playwright";
import { scriptMutates } from "../engine/risk";

/**
 * A read-only page script: collect data from the DOM in one call (many rows, several elements, computed values)
 * instead of many element reads. Anything that can change the page or the site is refused before it runs: the
 * writes scriptMutates knows, plus DOM edits, sending requests other than a plain GET fetch, opening windows,
 * history changes and indirect code (eval, Function, computed calls, escapes) that would hide them.
 */
const NOT_READ_ONLY: Array<[RegExp, string]> = [
  [/\b(eval|Function|setTimeout|setInterval|importScripts)\s*\(|\bimport\s*\(|new\s+Function\b/, "indirect code (eval, Function, timers, import)"],
  [/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon|\bpostMessage\s*\(|new\s+Worker\b|\bwindow\.open\s*\(|\bopen\s*\(/, "requests or windows other than a GET fetch"],
  [/\bfetch\b[\s\S]*\b(method|body|keepalive)\s*[:=]|\b(method|body|keepalive)\s*[:=][\s\S]*\bfetch\b/, "fetch with a method or body (only plain GET reads are allowed)"],
  [/\bhistory\.(push|replace)State|\.(go|back|forward)\s*\(\s*\)|\breload\s*\(/, "navigation"],
  [/\.(append|appendChild|prepend|remove|removeChild|replaceChild|replaceWith|replaceChildren|insertBefore|insertAdjacent\w*|before|after|setAttribute\w*|removeAttribute\w*|toggleAttribute|focus|blur|select|showModal|showPicker|requestFullscreen|play|pause)\s*\(/, "DOM changes or focus"],
  [/\.(classList|dataset|style)\b[^;\n]*?(\.(add|remove|toggle|replace|setProperty)\s*\(|(?<![=!<>])=(?!=))|\.(outerHTML|innerText|className|id|src|href|checked|selected|disabled|scrollTop|scrollLeft)\s*=(?!=)/, "DOM changes"],
  [/\]\s*\(|\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|\batob\s*\(|fromCharCode/i, "computed calls or escaped code"],
  [/\b(indexedDB|caches|navigator\.(clipboard|credentials|serviceWorker))\b|document\.(write|open|execCommand)\b/, "storage, clipboard or document writes"],
];

export function readOnlyProblem(source: string): string | undefined {
  if (scriptMutates(source)) return "clicks, submits, events, typed values, storage, cookies or navigation";
  for (const [re, why] of NOT_READ_ONLY) if (re.test(source)) return why;
  return undefined;
}

export async function runReadScript(page: Page, source: string, opts: { offset?: number; maxChars?: number } = {}) {
  if (typeof source !== "string" || !source.trim() || source.length > 8000) return { ok: false, execution: "not_started", reason: "invalid_script" };
  const problem = readOnlyProblem(source);
  if (problem) return { ok: false, execution: "not_started", reason: "not_read_only", detail: problem,
    hint: "run_script only reads. Use click, fill, select, press or navigate for anything that changes the page." };
  // A function body (with return) or a single expression; await works in both.
  const body = /\breturn\b/.test(source) ? source : `return (${source});`;
  const expression = `(async () => { ${body} })()`;
  let value: any;
  try {
    value = await Promise.race([
      page.evaluate(expression),
      new Promise((_, reject) => setTimeout(() => reject(new Error("script_timeout")), 15000)),
    ]);
  } catch (error: any) {
    return { ok: false, execution: error?.message === "script_timeout" ? "outcome_unknown" : "failed", reason: error?.message === "script_timeout" ? "timeout" : "script_error",
      error: String(error?.message || error).split("\n")[0].slice(0, 400) };
  }
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const budget = Math.max(2000, Math.min(opts.maxChars || 15000, 40000));
  const offset = Math.max(0, opts.offset || 0);
  if (offset === 0 && text.length <= budget) return { ok: true, value };
  const chunk = text.slice(offset, offset + budget);
  return { ok: true, length: text.length, offset, nextOffset: offset + chunk.length < text.length ? offset + chunk.length : undefined,
    value: chunk, note: "Long result: returned as text in parts. Pass offset to read on, or return less." };
}
