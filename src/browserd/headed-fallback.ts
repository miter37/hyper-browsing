/** Display recovery is separate from replay: changing mode invalidates live refs. */
const SUPPORTED = new Set(['session.open', 'page.goto', 'page.snapshot', 'page.list', 'page.forms', 'page.extract', 'page.screenshot', 'page.waitFor', 'page.hover', 'page.click', 'page.fill', 'page.select', 'page.press', 'batch.run', 'action.run']);
const NO_SWITCH = new Set(['ambiguous', 'stale_ref', 'invalid_target', 'value_mismatch', 'disabled', 'clipped', 'revision_changed', 'site_mismatch', 'fingerprint_mismatch']);
const LOCATOR_FAILURE = new Set(['no_match','wrong_element','hidden_only','not_visible','outside_viewport','blocked_by_overlay']);
const READS = new Set(['page.snapshot', 'page.list', 'page.forms', 'page.extract', 'page.screenshot', 'page.waitFor']);

export function needsHeadedFallback(method: string, result: any): boolean {
  if (!SUPPORTED.has(method) || !result || result.confirmationRequired || NO_SWITCH.has(result.reason) || result.verification?.outcome === 'APPLIED') return false;
  if (result.failureClass && ['confirmation', 'auth'].includes(result.failureClass)) return false;
  const state = result.pageState?.state || result.snapshot?.pageState?.state || result.effect?.pageState?.state;
  if (['blocked','navigation_error','loading'].includes(state)) return true;
  if (LOCATOR_FAILURE.has(result.reason)) return false;
  return Boolean(result.blocked || result.snapshot?.blocked || result.effect?.blocked || result.interstitial === 'still' || result.navigationError ||
    ([403,429,503].includes(result.status) && result.interstitial !== 'passed') || result.ok === false);
}
export function safeHeadedRetry(method: string, params: any): boolean {
  // Only known read operations and an explicitly requested navigation are replayable.
  // Raw evaluation, saved implementations, writes and batches are never inferred safe.
  return !params.ref && (READS.has(method) || method === 'page.goto');
}
export function recoverableBrowserError(error: any): boolean {
  return /timeout|timed out|target.*closed|browser.*closed|page.*closed|net::ERR_|navigation.*failed|CDP|connection.*closed/i.test(error?.message || '');
}
