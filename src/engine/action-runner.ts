import path from "node:path";
import { navigate } from "./navigate";
import type { Page } from "playwright";
import type { AppConfig } from "../config";
import type { ActionDefinition, SiteDefinition, VerifyDefinition } from "../schema/site";
import type { SiteActionContext } from "../sdk/types";
import { locatorFor } from "./locators";
import { runExtractor } from "./extractors";
import { detectState } from "./state";
import { evaluateCondition } from "./conditions";
import { effectiveRisk, isWriteLike, requiresConfirmation } from "./risk";
import { verifyAction } from "./verify";
import { appendMetric, type VerificationOutcome } from "../runtime/metrics";
import { classifyError } from "./failure";
import { interpolate, interpolateUrl } from "../utils/strings";
import { loadActionModule, type LoadedSite } from "./site-loader";
import { promoteAfterSuccess, type Lifecycle } from "./lifecycle";
import { actionRevision, assetStatus, hasSemanticVerification, recordAssetFailure, recordAssetSuccess } from "./asset-state";
import { rescueElement, saveElementStrategy, repairBrief } from "./self-repair";
import { hostMatches, matchesGlob } from "../utils/glob";
import { matchFingerprint } from "./fingerprint";
import { environmentFailure } from "./environment";
import { executePrimitive, DEFAULT_ACTION_TIMEOUT_MS } from "./execute";

export interface RunActionOptions {
  sessionId: string;
  actionId: string;
  input: Record<string, unknown>;
  confirmed?: boolean;
  expectedRevision?: string;
  validationOnly?: boolean;
}

function resolveUrl(page: Page, template: string): string {
  if (/^https?:\/\//i.test(template)) return template;
  return new URL(template, page.url()).toString();
}

class StepExecutionError extends Error {
  constructor(public steps: Record<string, any>[], public result: Record<string, any>) { super(`Saved step failed: locator/action ${result.reason || "unknown"}`); }
}
// Elements a run found again with a looser strategy: saved once the run is verified.
type Healed = Array<{ element: string; strategy: any }>;
const LOOKUP_FAILURES = ["no_match", "hidden_only", "not_found", "ambiguous"];
async function runDeclarative(page: Page, site: SiteDefinition, steps: any[], input: Record<string, unknown>, confirmed?: boolean, healed?: Healed) {
  const results: Record<string, any>[] = [];
  for (const step of steps) {
    if (step.op === "goto") {
      const template = site.urlTemplates[step.urlTemplate];
      if (!template) throw new Error(`Unknown URL template: ${step.urlTemplate}`);
      const result = await navigate(page, resolveUrl(page, interpolateUrl(template, input)));
      results.push({ op: "goto", execution: "completed", ...result });
      if ((result.status || 0) >= 400 && result.interstitial !== "passed") throw new StepExecutionError(results, { ok: false, reason: result.status === 401 ? "auth" : [403, 429].includes(result.status || 0) ? "blocking" : "network", execution: "completed" });
    } else if (["click", "fill", "select", "press"].includes(step.op)) {
      const element = step.element ? site.elements[step.element] : undefined;
      if (step.element && !element) throw new Error(`Unknown element: ${step.element}`);
      const stepParams = { confirmed, vars: input,
        value: step.op === "fill" ? interpolate(step.value, input) : undefined,
        option: step.op === "select" ? interpolate(step.value, input) : undefined, key: step.key };
      let result: any = await executePrimitive(page, step.op, { element, ...stepParams });
      // The saved control was not found: look for it again, more loosely, before giving up.
      if (!result.ok && element && healed && LOOKUP_FAILURES.includes(result.reason) && result.execution !== "outcome_unknown") {
        const strategy = await rescueElement(page, element, result, input).catch(() => undefined);
        if (strategy) {
          const retry: any = await executePrimitive(page, step.op, { locator: strategy, ...stepParams });
          if (retry.ok) { healed.push({ element: step.element, strategy }); result = { ...retry, healedWith: strategy }; }
        }
      }
      results.push({ op: step.op, element: step.element, ...result });
      if (!result.ok || result.observationRequired) throw new StepExecutionError(results, { ...result, element: step.element, reason:result.reason || 'observation_required' });
    } else if (step.op === "wait_for") {
      const timeoutMs = step.timeoutMs ?? 10_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluateCondition(page, site, step.condition, input).catch(() => false)) break;
        await page.waitForTimeout(100);
      }
      if (!(await evaluateCondition(page, site, step.condition, input).catch(() => false))) {
        throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
      }
      results.push({ op: "wait_for", execution: "completed", ok: true });
    } else if (step.op === "script") {
      // Evaluated as an expression through CDP, so a page's CSP (no eval) does not block it.
      const expression = `(async (input) => {\n${step.source}\n})(${JSON.stringify(input ?? {})})`;
      try {
        const value = await page.evaluate(expression);
        results.push({ op: "script", execution: "completed", ok: true, returned: value });
      } catch (error: any) {
        const message = String(error?.message || error).split("\n")[0];
        results.push({ op: "script", execution: "completed", ok: false, error: message });
        throw new StepExecutionError(results, { ok: false, reason: "script_error", execution: "completed", error: message });
      }
    }
  }
  return results;
}

/** What a script step gave back, if any: the last script step's value. */
function scriptResult(steps: Record<string, any>[]) {
  const scripted = steps.filter((s) => s.op === "script" && s.ok);
  return scripted.length ? { value: scripted[scripted.length - 1].returned } : undefined;
}
export function isEmptyResult(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)
    || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value as object).length);
}

export async function runKnownAction(config: AppConfig, page: Page, loaded: LoadedSite, options: RunActionOptions) {
  let revision: string;
  try { revision = await actionRevision(loaded, options.actionId); }
  catch (error: any) { return { ok: false, fallbackRequired: true, stage: "preflight", executionError: error.message, failureClass: "structure", retryPolicy: "observe-and-repair the missing action implementation" }; }
  if (options.expectedRevision && revision !== options.expectedRevision) return { ok: false, revision, fallbackRequired: true, validationSkipped: true, reason: "revision_changed", stage: "preflight" };
  const candidate = loaded.definition.actions[options.actionId];
  if (options.validationOnly && !(candidate.risk === "read" && candidate.implementation.kind === "declarative" && candidate.implementation.steps.length === 0 && candidate.returns?.extractor && !candidate.variants)) {
    return { ok: false, revision, validationSkipped: true, reason: "not_pure_extraction", stage: "preflight" };
  }
  const recovery = await assetStatus(config, loaded.definition.site.id, options.actionId, revision);
  if (recovery.suspended) return { ok: false, revision, recovery, fallbackRequired: true, stage: "preflight", retryPolicy: "observe-and-repair; do not replay suspended version" };
  try { return await executeKnownAction(config, page, loaded, options, revision); }
  catch (error: any) {
    const failureClass = classifyError(error);
    await recordAssetFailure(config, loaded.definition.site.id, options.actionId, revision, failureClass, options.sessionId).catch(() => {});
    return { ok: false, revision, executionError: error?.message || String(error), failureClass,
      recovery: await assetStatus(config, loaded.definition.site.id, options.actionId, revision),
      fallbackRequired: true, stage: "preflight", retryPolicy: "verify writes before retry; observe current page" };
  }
}

async function executeKnownAction(config: AppConfig, page: Page, loaded: LoadedSite, options: RunActionOptions, revision: string) {
  const healed: Healed = [];
  page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
  const site = loaded.definition;
  const action = site.actions[options.actionId];
  if (!action) throw new Error(`Unknown action: ${options.actionId}`);
  const environment = await environmentFailure(page);
  if (environment) return { ok: false, revision, failureClass: environment, fallbackRequired: true,
    recovery: await assetStatus(config, site.site.id, options.actionId, revision), stage: "preflight", retryPolicy: "resolve environment first; verify writes before retry" };

  const url = new URL(page.url());
  // An action that starts by loading one of the site's addresses does not depend on the page it starts from.
  const opensItsOwnPage = action.implementation.kind === "declarative" && action.implementation.steps[0]?.op === "goto";
  if (!opensItsOwnPage && (!site.match.hosts.some(h => hostMatches(url.hostname, h)) ||
      (site.match.urlPatterns?.length && !site.match.urlPatterns.some(p => matchesGlob(url.pathname + url.search, p))))) {
    return { ok: false, revision, applicable: false, fallbackRequired: true, reason: "site_mismatch" };
  }
  if (!opensItsOwnPage && site.match.fingerprints?.length) {
    const matches = await Promise.all(site.match.fingerprints.map(fp => matchFingerprint(page, site, fp).catch(() => false)));
    if (!matches.some(Boolean)) return { ok: false, revision, applicable: false, fallbackRequired: true, reason: "fingerprint_mismatch" };
  }

  const detected = await detectState(page, site);
  if (action.allowedStates?.length && (!detected.state || !action.allowedStates.includes(detected.state))) {
    throw new Error(`Action ${options.actionId} not allowed in state ${detected.state || "UNKNOWN"}`);
  }
  for (const preconditionId of action.preconditions ?? []) {
    const condition = site.preconditions[preconditionId];
    if (!condition) throw new Error(`Unknown precondition: ${preconditionId}`);
    if (!(await evaluateCondition(page, site, condition, options.input))) throw new Error(`Precondition failed: ${preconditionId}`);
  }

  const variant = detected.variant || "_unknown";
  const variantSpec = action.variants ? action.variants[variant] : undefined;
  if (action.variants && !variantSpec) {
    throw new Error(`Action ${options.actionId} has variant-specific knowledge but no implementation for UI variant ${variant}`);
  }
  const implementation = variantSpec?.implementation ?? action.implementation;
  if (implementation.kind === "code" && !config.allowCodeActions) {
    return { ok: false, execution: "not_started", reason: "code_actions_disabled", revision,
      hint: "Code actions have full local Node privileges. Set WEBAGENT_ALLOW_CODE_ACTIONS=1 only for trusted local site code." };
  }
  const verify = (variantSpec?.verify ?? action.verify) as VerifyDefinition[];
  const semanticVerified = hasSemanticVerification(verify);
  const storedLifecycle = (variantSpec?.lifecycle ?? action.lifecycle) as Lifecycle;
  const evidence = await (await import("../runtime/metrics")).evidenceFor(config, site.site.id, options.actionId, variant, revision);
  const lifecycle: Lifecycle = evidence.successfulSessions >= 2 ? "verified" : evidence.successes >= 1 ? "candidate" : "encoded";
  const risk = effectiveRisk(options.actionId, action as ActionDefinition);
  if (requiresConfirmation(risk) && !options.confirmed) {
    return { ok: false, confirmationRequired: true, risk, lifecycle, state: detected.state, variant };
  }

  const started = Date.now();
  let returned: unknown;
  let executionError: unknown;
  let steps: Record<string, any>[] = [];
  try {
    if (implementation.kind === "declarative") {
      steps = await runDeclarative(page, site, implementation.steps, options.input, options.confirmed, healed);
      const scripted = scriptResult(steps);
      if (scripted) returned = scripted.value;
    } else {
      const mod = await loadActionModule(loaded);
      const exportName = implementation.export || options.actionId;
      const fn = mod[exportName];
      if (!fn) throw new Error(`Missing code action export: ${exportName} in ${path.join(loaded.dir, "actions.ts")}`);
      const ctx: SiteActionContext = {
        page,
        input: options.input,
        site,
        sessionId: options.sessionId,
        variant,
        locator: (id) => locatorFor(page, site, id, options.input),
        extract: (id) => runExtractor(page, site, id, options.input),
        detectState: () => detectState(page, site),
        act: (kind, params) => executePrimitive(page, kind, { ...params, confirmed: options.confirmed }),
      };
      returned = await fn(ctx);
    }
  } catch (error) {
    executionError = error;
    if (error instanceof StepExecutionError) steps = error.steps;
  }

  if (!executionError && action.returns?.extractor) {
    try { returned = await runExtractor(page, site, action.returns.extractor, options.input); }
    catch (error) { executionError = error; }
  }

  // Invariant: a write-like action that throws/timeouts is verified before any retry.
  // This MVP performs no blind retry; the result stays UNKNOWN/NOT_APPLIED for the caller to decide.
  let verification: { outcome: VerificationOutcome; details: any[] } = await verifyAction(page, site, verify, options.input).catch((error: any) => ({
    outcome: "UNKNOWN" as VerificationOutcome,
    details: [{ condition: "verification", error: error?.message || String(error) }],
  }));
  // A read action whose script read data off the page is checked by that data: something came back.
  const scripted = !executionError && implementation.kind === "declarative" ? scriptResult(steps) : undefined;
  if (!verify.length && scripted && risk === "read") {
    const got = !isEmptyResult(scripted.value);
    verification = { outcome: got ? "APPLIED" : "NOT_APPLIED", details: [{ condition: "script returned data", ok: got }] };
  }

  const applied = verification.outcome === "APPLIED";
  // The desired state can predate this attempt. An interrupted implementation
  // does not provide successful revision evidence, even if its outcome is applied.
  const ok = !executionError && applied;
  const verificationError = verification.details.find((d: any) => d.error)?.error;
  const failedStep = executionError instanceof StepExecutionError ? executionError.result : undefined;
  const failureClass = executionError ? failedStep?.confirmationRequired ? "confirmation" : ["auth", "blocking", "network"].includes(failedStep?.reason) ? failedStep!.reason : classifyError(executionError) : applied ? undefined :
    (await environmentFailure(page)) || (verification.outcome === "UNKNOWN" ? classifyError(verificationError || "unknown verification") : "verification");
  await appendMetric(config, {
    timestamp: new Date().toISOString(),
    sessionId: options.sessionId,
    site: site.site.id,
    action: options.actionId,
    variant,
    ok,
    verified: verification.outcome,
    durationMs: Date.now() - started,
    failureClass,
    error: executionError ? String((executionError as any)?.message || executionError).slice(0, 500) : undefined,
    revision,
    semanticVerified,
  }).catch(() => {});

  // Self-repair: a read action that found a moved control again and still verified keeps the strategy that worked.
  let repaired: any[] | undefined;
  if (ok && applied && healed.length && risk === "read") {
    repaired = [];
    for (const h of healed) repaired.push(await saveElementStrategy(config, loaded, h.element, h.strategy, "self", options.sessionId).catch((e: any) => ({ element: h.element, error: e.message })));
  }
  const repair = !ok && failedStep?.element && site.elements[failedStep.element] && LOOKUP_FAILURES.includes(failedStep.reason)
    ? repairBrief(site.site.id, failedStep.element, site.elements[failedStep.element], failedStep) : undefined;
  if (ok && applied) await recordAssetSuccess(config, site.site.id, options.actionId, revision, options.sessionId).catch(() => {});
  else if (failureClass) await recordAssetFailure(config, site.site.id, options.actionId, revision, failureClass, options.sessionId).catch(() => {});

  let promotion;
  if (ok && applied && semanticVerified) {
    promotion = await promoteAfterSuccess(config, loaded, options.actionId, variant, lifecycle, Boolean(variantSpec), revision).catch(() => undefined);
  }

  return {
    ok,
    risk,
    lifecycle,
    storedLifecycle,
    // A script's value is the action's result (returned); the step record does not repeat it.
    steps: steps.map((s) => s.op === "script" && "returned" in s ? (({ returned: _r, ...rest }) => rest)(s) : s),
    state: detected.state,
    variant,
    verification,
    returned,
    executionError: executionError ? String((executionError as any)?.message || executionError) : undefined,
    failureClass,
    promotion,
    revision,
    ...(repaired ? { repaired } : {}),
    ...(healed.length && !repaired ? { healedButNotSaved: healed, healNote: "Found by a looser match; not saved (write action or not verified). Confirm and save with site_repair." } : {}),
    ...(repair ? { repair } : {}),
    semanticVerified,
    recovery: await assetStatus(config, site.site.id, options.actionId, revision),
    fallbackRequired: !ok,
    execution: failedStep?.execution || (executionError ? "outcome_unknown" : "completed"),
    confirmationRequired: Boolean(failedStep?.confirmationRequired),
    retryPolicy: isWriteLike(risk) ? "verify-before-retry; no blind retry" : "caller may retry after classifying transient failure",
  };
}
