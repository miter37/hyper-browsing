import fs from "node:fs/promises";
import type { AppConfig } from "./config";
import { loadSite } from "./engine/site-loader";
import { scanActionFile } from "./security/action-scan";
import path from "node:path";

export async function validateSites(config: AppConfig, siteId?: string) {
  const ids = siteId ? [siteId] : (await fs.readdir(config.sitesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);
  const results = [];

  for (const id of ids) {
    try {
      const loaded = await loadSite(config, id);
      const site = loaded.definition;
      const errors: string[] = [];

      const checkFingerprintAtom = (atom: any, where: string) => {
        if (atom.element && !site.elements[atom.element]) errors.push(`${where} references missing element: ${atom.element}`);
        if (atom.fingerprint && !site.fingerprints[atom.fingerprint]) errors.push(`${where} references missing fingerprint: ${atom.fingerprint}`);
      };
      const checkCondition = (condition: any, where: string) => {
        if (condition.all) condition.all.forEach((x: any) => checkCondition(x, where));
        else if (condition.any) condition.any.forEach((x: any) => checkCondition(x, where));
        else if (condition.type === "fingerprint" && !site.fingerprints[condition.name]) errors.push(`${where} references missing fingerprint: ${condition.name}`);
        else if (condition.type === "element_visible" && !site.elements[condition.element]) errors.push(`${where} references missing element: ${condition.element}`);
        else if (condition.type === "extractor_equals" && !site.extractors[condition.extractor]) errors.push(`${where} references missing extractor: ${condition.extractor}`);
        else if (condition.type === "state_is" && !site.states[condition.state]) errors.push(`${where} references missing state: ${condition.state}`);
      };

      for (const fp of site.match.fingerprints ?? []) if (!site.fingerprints[fp]) errors.push(`match references missing fingerprint: ${fp}`);
      for (const [fpId, fp] of Object.entries(site.fingerprints)) {
        for (const atom of [...(fp.all ?? []), ...(fp.any ?? [])]) checkFingerprintAtom(atom, `fingerprint ${fpId}`);
      }
      for (const [stateId, state] of Object.entries(site.states)) {
        for (const fp of state.variants) if (!site.fingerprints[fp]) errors.push(`state ${stateId} references missing fingerprint: ${fp}`);
        if (state.readyWhen) checkCondition(state.readyWhen, `state ${stateId}.readyWhen`);
      }
      for (const [elementId, element] of Object.entries(site.elements)) {
        for (const strategy of element.strategies) {
          if (strategy.css && /\{\{?[a-zA-Z0-9_.-]+\}?\}/.test(strategy.css))
            errors.push(`element ${elementId} interpolates CSS; use css + hasText to bind dynamic text`);
        }
      }
      for (const [extractorId, ex] of Object.entries(site.extractors)) if (!site.elements[ex.element]) errors.push(`extractor ${extractorId} references missing element: ${ex.element}`);
      for (const [pcId, pc] of Object.entries(site.preconditions)) checkCondition(pc, `precondition ${pcId}`);

      let hasCodeAction = false;
      for (const [actionId, action] of Object.entries(site.actions)) {
        for (const st of action.allowedStates ?? []) if (!site.states[st]) errors.push(`action ${actionId} references missing state: ${st}`);
        for (const pc of action.preconditions ?? []) if (!site.preconditions[pc]) errors.push(`action ${actionId} references missing precondition: ${pc}`);
        const implementations = [action.implementation, ...Object.values(action.variants ?? {}).map((v) => v.implementation).filter(Boolean)] as any[];
        for (const implementation of implementations) {
          if (implementation.kind === "code") hasCodeAction = true;
          if (implementation.kind === "declarative") for (const step of implementation.steps) {
            if (step.element && !site.elements[step.element]) errors.push(`action ${actionId} step references missing element: ${step.element}`);
            if (step.urlTemplate && !site.urlTemplates[step.urlTemplate]) errors.push(`action ${actionId} step references missing URL template: ${step.urlTemplate}`);
            if (step.condition) checkCondition(step.condition, `action ${actionId} wait condition`);
          }
        }
        for (const v of action.verify ?? []) checkCondition(v, `action ${actionId} verify`);
        for (const [variantId, variant] of Object.entries(action.variants ?? {})) {
          if (!site.fingerprints[variantId]) errors.push(`action ${actionId} variant key should name a known fingerprint: ${variantId}`);
          for (const v of variant.verify ?? []) checkCondition(v, `action ${actionId} variant ${variantId} verify`);
        }
      }
      if (hasCodeAction) {
        try { await scanActionFile(path.join(loaded.dir, "actions.ts")); }
        catch (error: any) { errors.push(error?.message || String(error)); }
      }
      results.push({ site: id, ok: errors.length === 0, errors });
    } catch (error: any) {
      results.push({ site: id, ok: false, errors: [error?.message || String(error)] });
    }
  }
  return results;
}
