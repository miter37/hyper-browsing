import type { Locator, Page } from "playwright";
import type { SiteDefinition } from "../schema/site";
import type { ActionKind } from "../engine/interact";
import type { PrimitiveParams } from "../engine/execute";

export interface SiteActionContext {
  page: Page;
  input: Record<string, unknown>;
  site: SiteDefinition;
  sessionId: string;
  variant?: string;
  locator(elementId: string): Promise<Locator>;
  extract(extractorId: string): Promise<string | null>;
  detectState(): Promise<{ state?: string; variant?: string }>;
  act(kind: ActionKind, params: PrimitiveParams): Promise<Record<string, any>>;
}

export type SiteActionFunction = (ctx: SiteActionContext) => Promise<unknown>;
export type SiteActionModule = Record<string, SiteActionFunction>;
