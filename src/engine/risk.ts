import type { ActionDefinition } from "../schema/site";

export type Risk = "read" | "local_write" | "external_write" | "irreversible" | "unclassified";

const rank: Record<Risk, number> = { read: 0, local_write: 1, external_write: 2, irreversible: 3, unclassified: 4 };
export const irreversible = /(delete|destroy|remove_account|close_account|erase|terminate)/i;
export const externalWrite = /(pay|purchase|buy|submit|send|post|comment|invite|refund|transfer|publish|permission|grant|revoke|status|update|edit|save)/i;

export function effectiveRisk(actionId: string, action: ActionDefinition): Risk {
  // A declarative extraction has no state-changing steps; names like account_status do not make it a write.
  if (action.risk === "read" && action.implementation.kind === "declarative" && action.implementation.steps.length === 0 && action.returns?.extractor && !action.variants) return "read";
  let inferred: Risk = "read";
  const haystack = [actionId];
  if (action.implementation.kind === "declarative") {
    for (const step of action.implementation.steps as any[]) {
      if (step.element) haystack.push(step.element);
      if (step.op) haystack.push(step.op);
    }
  }
  const text = haystack.join(" ");
  if (irreversible.test(text)) inferred = "irreversible";
  else if (externalWrite.test(text)) inferred = "external_write";
  const declared = action.risk as Risk;
  return rank[inferred] > rank[declared] ? inferred : declared;
}

export function requiresConfirmation(risk: Risk): boolean {
  return risk === "external_write" || risk === "irreversible" || risk === "unclassified";
}

export function isWriteLike(risk: Risk): boolean {
  return risk !== "read";
}

export function heuristicRiskFromText(text: string): Risk {
  if (irreversible.test(text)) return "irreversible";
  if (externalWrite.test(text)) return "external_write";
  return "read";
}
