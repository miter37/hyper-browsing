import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { AppConfig } from "../config";
import { redactText } from "../utils/strings";

export interface SnapshotElement {
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  placeholder?: string;
  label?: string;
  href?: string;
}

export interface PageSnapshot {
  capturedAt: string;
  url: string;
  title: string;
  headings: string[];
  elements: SnapshotElement[];
  truncated?: boolean;
}

const SNAPSHOT_EVAL_SCRIPT = `
(() => {
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
    return true;
  }

  function cleanStr(s) {
    if (!s || typeof s !== "string") return undefined;
    const trimmed = s.replace(/\\s+/g, " ").trim();
    return trimmed.length ? trimmed : undefined;
  }

  const title = cleanStr(document.title) || "";
  const headings = [];
  const hNodes = document.querySelectorAll("h1, h2, h3");
  for (let i = 0; i < hNodes.length && headings.length < 20; i++) {
    const h = hNodes[i];
    if (isVisible(h)) {
      const t = cleanStr(h.innerText);
      if (t) headings.push(t);
    }
  }

  const candidates = document.querySelectorAll("a, button, input, select, textarea, [role], [data-testid]");
  const elements = [];
  let truncated = false;

  for (let i = 0; i < candidates.length; i++) {
    if (elements.length >= 160) {
      truncated = true;
      break;
    }
    const el = candidates[i];
    if (!isVisible(el)) continue;

    const tag = String(el.tagName || "").toLowerCase();
    const role = cleanStr(el.getAttribute("role"));
    if (role && (role === "generic" || role === "presentation" || role === "none")) continue;

    const ariaLabel = cleanStr(el.getAttribute("aria-label"));
    const inner = cleanStr(el.innerText);
    const name = ariaLabel || inner;
    const text = (name && inner && name === inner) ? undefined : inner;
    const testId = cleanStr(el.getAttribute("data-testid"));
    const placeholder = cleanStr(el.getAttribute("placeholder"));
    const href = cleanStr(el.getAttribute("href"));
    const label = el.labels && el.labels[0] && el.labels[0].innerText ? cleanStr(el.labels[0].innerText) : undefined;

    elements.push({
      tag,
      role: role || undefined,
      name: name || undefined,
      text: text || undefined,
      testId: testId || undefined,
      placeholder: placeholder || undefined,
      label: label || undefined,
      href: href || undefined,
    });
  }

  return {
    url: window.location.href,
    title,
    headings,
    elements,
    truncated,
  };
})()
`;

export async function captureSnapshot(
  page: Page,
  options: { query?: string; selector?: string } = {}
): Promise<PageSnapshot> {
  const data: any = await page.evaluate(SNAPSHOT_EVAL_SCRIPT);

  let elements = (data.elements || []).map((e: any) => ({
    ...e,
    name: e.name ? redactText(e.name) : undefined,
    text: e.text ? redactText(e.text) : undefined,
    href: e.href ? redactText(e.href) : undefined,
  }));

  // Targeted filtering: filter by query text or tag/role/testId
  if (options.query) {
    const q = options.query.toLowerCase();
    elements = elements.filter((e: any) => {
      const matchName = e.name && e.name.toLowerCase().includes(q);
      const matchText = e.text && e.text.toLowerCase().includes(q);
      const matchHref = e.href && e.href.toLowerCase().includes(q);
      const matchRole = e.role && e.role.toLowerCase().includes(q);
      const matchTestId = e.testId && e.testId.toLowerCase().includes(q);
      return matchName || matchText || matchHref || matchRole || matchTestId;
    });
  }

  return {
    capturedAt: new Date().toISOString(),
    url: data.url,
    title: redactText(data.title),
    headings: (data.headings || []).map(redactText),
    elements,
    truncated: Boolean(data.truncated),
  };
}

export async function saveSnapshot(config: AppConfig, sessionId: string, snapshot: PageSnapshot): Promise<string> {
  const file = path.join(config.runtimeDir, "snapshots", `${Date.now()}-${sessionId}.json`);
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return file;
}
