import type { Page } from "playwright";
import { detectBlock } from "./page-state";

/** Positive environment evidence only; a missing result by itself is not an environment diagnosis. */
export async function environmentFailure(page: Page): Promise<"auth" | "blocking" | "network" | "timeout" | undefined> {
  if (await detectBlock(page)) return "blocking";
  return page.evaluate<"auth" | "network" | "timeout" | null>(`(() => {
    const shown = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const heading = ((document.querySelector('h1')?.textContent || '') + ' ' + document.title).toLowerCase();
    const authForm = [...document.querySelectorAll('input[type=password],input[autocomplete=one-time-code]')].some(shown);
    if (authForm && /sign.?in|log.?in|로그인|인증 코드|verification code/.test(heading)) return 'auth';
    if (/\\/(login|signin|sign-in|authenticate)(\\/|$)/i.test(location.pathname) && /sign.?in|log.?in|로그인|인증/.test(heading)) return 'auth';
    if (!navigator.onLine || /err_connection|err_network|502 bad gateway|503 service unavailable|504 gateway timeout/.test(heading)) return 'network';
    if (document.readyState === 'loading' || [...document.querySelectorAll('[aria-busy=true],[role=progressbar]')].some(shown)) return 'timeout';
    return null;
  })()`).then(value => value || undefined).catch(() => undefined);
}
