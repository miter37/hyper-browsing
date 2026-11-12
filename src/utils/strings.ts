/** Expand preferred {{name}} and legacy {name} placeholders. */
export function interpolate(template: string, vars: Record<string, unknown>, encode: (value: string) => string = value => value): string {
  return template.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}|\{([a-zA-Z0-9_.-]+)\}/g, (_match, doubleKey: string | undefined, singleKey: string | undefined) => {
    const key = doubleKey || singleKey!;
    const value = vars[key];
    if (value === undefined || value === null) throw new Error(`Missing variable: ${key}`);
    return encode(String(value));
  });
}

/** URL-template values are components, never trusted URL syntax. */
export function interpolateUrl(template: string, vars: Record<string, unknown>): string {
  return interpolate(template, vars, encodeURIComponent);
}

export function redactText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>")
    .replace(/\b(?:sk|pk|api|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi, "<redacted-secret>")
    .replace(/\b[A-F0-9]{32,}\b/gi, "<redacted-id>")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "<redacted-long-token>")
    .slice(0, 500);
}
