/** Keep safety/state fields intact. Only expensive observations and traces are compacted. */
export function compactResult(value: any): any {
  if (Array.isArray(value)) return value.map(compactResult);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "snapshot") {
      if (child && typeof child === "object") for (const field of ["blocked", "truncated", "omitted", "diagnostics", "observation", "pageState"]) {
        if ((child as any)[field] !== undefined && result[field] === undefined) result[field] = (child as any)[field];
      }
      result.snapshotAvailable = true; continue;
    }
    if (["log", "stack"].includes(key)) continue;
    if (key === "verification" && child && typeof child === "object") {
      const verification: any = child;
      result.verification = { outcome: verification.outcome, checks: verification.details?.length,
        details: verification.details?.filter((d: any) => d.error || d.ok === false) };
      continue;
    }
    if (key === "effect" && child && typeof child === "object") {
      const effect: any = child;
      result.effect = Object.fromEntries(Object.entries(effect).map(([k, v]) => {
        if (k === "page" && v && typeof v === "object") {
          const page: any = v;
          return [k, { ...page, valueChanges: page.valueChanges ? { count: Object.keys(page.valueChanges).length } : undefined, stateChanges: page.stateChanges ? { count: Object.keys(page.stateChanges).length } : undefined }];
        }
        if (k === "targetChanged" && v && typeof v === "object") return [k, Object.keys(v)];
        return [k, v];
      }));
    } else result[key] = compactResult(child);
  }
  return result;
}
