import type { Page } from "playwright";
import type { SiteDefinition } from "../schema/site";
import { locatorFor } from "./locators";

export async function runExtractor(page: Page, site: SiteDefinition, extractorId: string, vars: Record<string, unknown> = {}): Promise<string | null> {
  const spec = site.extractors[extractorId];
  if (!spec) throw new Error(`Unknown extractor: ${extractorId}`);
  const locator = await locatorFor(page, site, spec.element, vars);
  if (!(await locator.count())) return null;
  if (spec.read === "text") return (await locator.innerText().catch(() => null))?.trim() ?? null;
  if (spec.read === "value") return await locator.inputValue().catch(() => null);
  return await locator.getAttribute(spec.attribute!);
}
