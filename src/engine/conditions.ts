import type { Page } from "playwright";
import type { ConditionDefinition, SiteDefinition } from "../schema/site";
import { matchFingerprint } from "./fingerprint";
import { locatorFor } from "./locators";
import { runExtractor } from "./extractors";
import { interpolate } from "../utils/strings";
import { matchesGlob } from "../utils/glob";

export async function evaluateCondition(page: Page, site: SiteDefinition, condition: ConditionDefinition, vars: Record<string, unknown>): Promise<boolean> {
  const c: any = condition;
  if (c.all) {
    for (const part of c.all) if (!(await evaluateCondition(page, site, part, vars))) return false;
    return true;
  }
  if (c.any) {
    for (const part of c.any) if (await evaluateCondition(page, site, part, vars)) return true;
    return false;
  }
  if (c.type === "fingerprint") return matchFingerprint(page, site, c.name);
  if (c.type === "element_visible") return (await locatorFor(page, site, c.element, vars)).isVisible().catch(() => false);
  if (c.type === "url_matches") return matchesGlob(page.url(), interpolate(c.pattern, vars));
  if (c.type === "extractor_equals") return (await runExtractor(page, site, c.extractor, vars)) === interpolate(c.value, vars);
  if (c.type === "extractor_exists") return (await runExtractor(page, site, c.extractor)) !== null;
  return false;
}
