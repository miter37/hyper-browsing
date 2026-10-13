import type { Page } from "playwright";

/**
 * Navigate in a way that survives ad-heavy pages and waiting for heavy SPA/anti-bot checks.
 */
export interface NavigateResult {
  url: string;
  title: string;
  /** "settled" when the network went quiet, "busy" when it never did (ads still loading). */
  network: "settled" | "busy";
  /** HTTP status of the main document (503, 403... tell an outage or a block from an empty page). */
  status?: number;
  /**
   * A bot-check interstitial was shown first: "passed" when the real page followed by itself (then `status` is the
   * interstitial's 403/429/503, not the page's), "still" when it was still showing after the wait.
   */
  interstitial?: "passed" | "still";
}

export const DEFAULT_NAV_TIMEOUT_MS = 45000;
export const DEFAULT_SETTLE_MS = 1500;

export async function navigate(page: Page, url: string, options: { timeoutMs?: number; settleMs?: number } = {}): Promise<NavigateResult> {
  const timeout = options.timeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });

  let network: NavigateResult["network"] = "busy";
  try {
    await page.waitForLoadState("networkidle", { timeout: settleMs });
    network = "settled";
  } catch {
    // Expected on ad-heavy sites; the document is already interactive.
  }

  // Automatic wait for Cloudflare challenge / interstitial loading pages (e.g. "잠시만 기다리십시오…", "Just a moment...")
  const isInterstitial = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes("잠시만") || t.includes("기다리") || t.includes("just a moment") || t.includes("checking your browser") || t.includes("attention required")) return true;
    // A challenge platform answering 403/429/503 with a placeholder title ("Loading <url>") and a challenge token.
    return /__cf_chl|cdn-cgi\/challenge/.test(page.url()) && [403, 429, 503].includes(response?.status() ?? 0);
  };

  let title = await page.title().catch(() => "");
  let interstitial: NavigateResult["interstitial"];
  if (isInterstitial(title)) {
    interstitial = "still";
    const interstitialDeadline = Date.now() + 15000;
    while (Date.now() < interstitialDeadline) {
      await page.waitForTimeout(1000);
      title = await page.title().catch(() => "");
      if (!isInterstitial(title) && !/^loading\b/i.test(title)) { interstitial = "passed"; break; }
    }
  }

  return { url: page.url(), title, network, status: response?.status(), interstitial };
}
