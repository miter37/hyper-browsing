import type { Page } from "playwright";
import { captureSnapshot, type PageSnapshot, type SnapshotElement } from "./snapshot";

export interface AnnoyanceResult {
  dismissedCount: number;
  actions: string[];
}

/**
 * 1. dismissAnnoyances
 * Automatically closes or removes cookie banners, newsletter modals, app banners, and obstructive overlays.
 */
export async function dismissAnnoyances(page: Page): Promise<AnnoyanceResult> {
  const actions: string[] = [];

  // Pass 1: Try clicking common consent / close buttons
  const buttonSelectors = [
    // Cookie / GDPR consent buttons
    "button:has-text('동의')", "button:has-text('모두 동의')", "button:has-text('수락')", "button:has-text('확인')",
    "button:has-text('Accept')", "button:has-text('Accept All')", "button:has-text('I agree')", "button:has-text('Allow all')",
    // Dismiss / Close buttons
    "button:has-text('닫기')", "button:has-text('다음에')", "button:has-text('나중에 하기')", "button:has-text('오늘 하루 보지 않기')",
    "button:has-text('Close')", "button:has-text('Dismiss')", "button:has-text('Not now')", "button:has-text('Maybe later')",
    "[aria-label='닫기']", "[aria-label='Close']", "[aria-label='Dismiss']",
    ".modal-close", ".popup-close", "[data-testid='close-button']",
  ];

  for (const sel of buttonSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
        await el.click({ force: true, timeout: 500 }).catch(() => {});
        actions.push(`Clicked: ${sel}`);
        await page.waitForTimeout(300);
      }
    } catch {}
  }

  // Pass 2: Detect remaining fixed/sticky backdrop overlays and remove them from DOM
  const removedFromDom = await page.evaluate(() => {
    let count = 0;
    const overlayKeywords = ["cookie", "consent", "gdpr", "modal", "dialog", "popup", "banner", "overlay", "backdrop"];
    const elements = Array.from(document.querySelectorAll("div, section, aside"));

    for (const el of elements) {
      const style = window.getComputedStyle(el);
      const isFixedOrAbsolute = style.position === "fixed" || (style.position === "absolute" && parseInt(style.zIndex, 10) > 100);
      if (!isFixedOrAbsolute) continue;

      const idClass = (el.id + " " + el.className).toLowerCase();
      const hasKeyword = overlayKeywords.some((kw) => idClass.includes(kw));

      if (hasKeyword) {
        // Hide overlay so it doesn't block clicks or pointer events
        (el as HTMLElement).style.display = "none";
        count++;
      }
    }

    // Unlock body scroll if it was locked by a modal
    if (document.body.style.overflow === "hidden") {
      document.body.style.overflow = "auto";
    }
    return count;
  }).catch(() => 0);

  if (removedFromDom > 0) {
    actions.push(`Removed ${removedFromDom} blocking overlay elements`);
  }

  return {
    dismissedCount: actions.length,
    actions,
  };
}

export interface FormFieldInfo {
  tag: string;
  name?: string;
  id?: string;
  type?: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  value?: string;
}

export interface FormInfo {
  formId?: string;
  formName?: string;
  action?: string;
  method?: string;
  fields: FormFieldInfo[];
  submitButton?: { tag: string; text?: string; role?: string };
}

/**
 * 2. analyzeForms
 * Automatically inspects and structures input forms, fields, labels, and submit buttons on the page.
 */
export async function analyzeForms(page: Page): Promise<{ formsCount: number; forms: FormInfo[] }> {
  const forms = await page.evaluate(() => {
    const results: any[] = [];
    const formNodes = Array.from(document.querySelectorAll("form"));

    // If no <form> tag exists, treat document as a single form container
    const containers = formNodes.length > 0 ? formNodes : [document.body];

    for (const container of containers) {
      const inputs = Array.from(container.querySelectorAll("input, textarea, select"));
      if (inputs.length === 0) continue;

      const fields = inputs.map((input: any) => {
        const id = input.id || undefined;
        let labelText: string | undefined;
        if (id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl) labelText = (labelEl as HTMLElement).innerText?.trim();
        }
        if (!labelText && input.labels && input.labels[0]) {
          labelText = input.labels[0].innerText?.trim();
        }

        return {
          tag: input.tagName.toLowerCase(),
          name: input.name || undefined,
          id,
          type: input.type || undefined,
          label: labelText || input.getAttribute("aria-label") || undefined,
          placeholder: input.placeholder || undefined,
          required: Boolean(input.required || input.getAttribute("aria-required") === "true"),
          value: input.type !== "password" ? (input.value || undefined) : "[PASSWORD]",
        };
      });

      let submitButton: any = undefined;
      const btn = container.querySelector("button[type='submit'], input[type='submit'], button");
      if (btn) {
        submitButton = {
          tag: btn.tagName.toLowerCase(),
          text: (btn as HTMLElement).innerText?.trim() || btn.getAttribute("value") || btn.getAttribute("aria-label") || undefined,
          role: btn.getAttribute("role") || undefined,
        };
      }

      results.push({
        formId: container instanceof HTMLFormElement ? (container.id || undefined) : "implicit_form",
        formName: container instanceof HTMLFormElement ? (container.getAttribute("name") || undefined) : undefined,
        action: container instanceof HTMLFormElement ? (container.action || undefined) : undefined,
        method: container instanceof HTMLFormElement ? (container.method || undefined) : undefined,
        fields,
        submitButton,
      });
    }

    return results;
  }).catch(() => []);

  return {
    formsCount: forms.length,
    forms,
  };
}

export interface SnapshotDiff {
  urlChanged: boolean;
  oldUrl: string;
  newUrl: string;
  titleChanged: boolean;
  oldTitle: string;
  newTitle: string;
  addedElements: SnapshotElement[];
  removedElements: SnapshotElement[];
  alertOrErrors: string[];
}

/**
 * 3. compareSnapshots
 * Diffs two snapshots (before and after an action) to pinpoint what changed and if errors appeared.
 */
export function compareSnapshots(before: PageSnapshot, after: PageSnapshot): SnapshotDiff {
  const elKey = (e: SnapshotElement) => `${e.tag}|${e.role || ""}|${e.name || ""}|${e.text || ""}|${e.testId || ""}`;

  const beforeMap = new Set(before.elements.map(elKey));
  const afterMap = new Set(after.elements.map(elKey));

  const addedElements = after.elements.filter((e) => !beforeMap.has(elKey(e)));
  const removedElements = before.elements.filter((e) => !afterMap.has(elKey(e)));

  // Identify new alert/error messages
  const alertOrErrors: string[] = [];
  for (const el of addedElements) {
    if (el.role === "alert" || el.testId?.includes("error") || el.name?.includes("오류") || el.name?.includes("실패") || el.name?.includes("Error")) {
      alertOrErrors.push(el.text || el.name || JSON.stringify(el));
    }
  }

  return {
    urlChanged: before.url !== after.url,
    oldUrl: before.url,
    newUrl: after.url,
    titleChanged: before.title !== after.title,
    oldTitle: before.title,
    newTitle: after.title,
    addedElements: addedElements.slice(0, 50),
    removedElements: removedElements.slice(0, 50),
    alertOrErrors,
  };
}

export interface ApiSniffResult {
  endpoint: string;
  method: string;
  status: number;
  contentType: string;
  dataPreview: any;
}

/**
 * 4. sniffApi
 * Sniffs backend API calls (JSON responses) during a specified quiet window.
 */
export async function sniffApi(page: Page, durationMs = 2500): Promise<{ count: number; apis: ApiSniffResult[] }> {
  const captured: ApiSniffResult[] = [];

  const onResponse = async (res: any) => {
    try {
      const url = res.url();
      const contentType = res.headers()["content-type"] || "";
      if (contentType.includes("application/json") || url.includes("/api/") || url.includes(".json")) {
        const text = await res.text().catch(() => "");
        let dataPreview: any = text;
        try {
          const parsed = JSON.parse(text);
          dataPreview = Array.isArray(parsed) ? parsed.slice(0, 3) : parsed;
        } catch {}

        captured.push({
          endpoint: url,
          method: res.request().method(),
          status: res.status(),
          contentType,
          dataPreview,
        });
      }
    } catch {}
  };

  page.on("response", onResponse);
  await page.waitForTimeout(durationMs);
  page.off("response", onResponse);

  return {
    count: captured.length,
    apis: captured.slice(0, 20),
  };
}

/**
 * 5. waitForIdle
 * Intelligently waits for DOM mutations and network calls to settle.
 */
export async function waitForIdle(page: Page, timeoutMs = 10000, minQuietMs = 500): Promise<{ settled: boolean; elapsedMs: number }> {
  const start = Date.now();
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 3000) }).catch(() => {});

    await page.evaluate(async (quietMs) => {
      return new Promise<void>((resolve) => {
        let timer: any;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, quietMs);
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, quietMs);
      });
    }, minQuietMs);

    return { settled: true, elapsedMs: Date.now() - start };
  } catch {
    return { settled: false, elapsedMs: Date.now() - start };
  }
}

/**
 * 6. scrollPage
 * Smoothly or directly scrolls the page or a target container to trigger lazy loading / infinite scroll.
 */
export async function scrollPage(
  page: Page,
  options: { direction?: "down" | "up"; distance?: number; times?: number; selector?: string; delayMs?: number } = {}
): Promise<{ scrolled: boolean; times: number; totalDistance: number }> {
  const direction = options.direction === "up" ? -1 : 1;
  const distance = (options.distance || 800) * direction;
  const times = Math.max(1, Math.min(options.times || 1, 20));
  const delayMs = options.delayMs || 300;
  const selector = options.selector;

  let totalDistance = 0;
  for (let i = 0; i < times; i++) {
    await page.evaluate(({ dist, sel }) => {
      if (sel) {
        const el = document.querySelector(sel);
        if (el) el.scrollTop += dist;
      } else {
        window.scrollBy(0, dist);
      }
    }, { dist: distance, sel: selector });

    totalDistance += Math.abs(distance);
    if (i < times - 1 && delayMs > 0) {
      await page.waitForTimeout(delayMs);
    }
  }

  // Small settle wait
  await page.waitForTimeout(200);
  return { scrolled: true, times, totalDistance };
}

/**
 * 7. waitForElement
 * Waits for an element matching a CSS selector or visible text to appear in DOM within timeout.
 */
export async function waitForElement(
  page: Page,
  options: { css?: string; text?: string; timeoutMs?: number; state?: "visible" | "attached" } = {}
): Promise<{ found: boolean; selector?: string; elapsedMs: number }> {
  const start = Date.now();
  const timeout = options.timeoutMs || 5000;
  const state = options.state || "visible";

  try {
    if (options.css) {
      await page.locator(options.css).first().waitFor({ timeout, state });
      return { found: true, selector: options.css, elapsedMs: Date.now() - start };
    }
    if (options.text) {
      await page.getByText(options.text).first().waitFor({ timeout, state });
      return { found: true, selector: `text=${options.text}`, elapsedMs: Date.now() - start };
    }
    throw new Error("Specify either --css or --text for wait-for");
  } catch {
    return { found: false, selector: options.css || options.text, elapsedMs: Date.now() - start };
  }
}
