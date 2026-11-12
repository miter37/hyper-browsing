/** Support both legacy {name} and the {{name}} templates shipped in site.yaml. */
const PLACEHOLDER = /\{\{([a-zA-Z0-9_.-]+)\}\}|\{([a-zA-Z0-9_.-]+)\}/g;

function substitute(template: string, vars: Record<string, unknown>, encode: (value: string) => string): string {
  return template.replace(PLACEHOLDER, (_match, double: string | undefined, single: string | undefined) => {
    const key = double || single;
    if (!key) throw new Error("Malformed template placeholder");
    const value = vars[key];
    if (value === undefined || value === null) throw new Error(`Missing variable: ${key}`);
    return encode(String(value));
  });
}

export function interpolate(template: string, vars: Record<string, unknown>): string {
  return substitute(template, vars, value => value);
}

/** Each placeholder represents one URL component, not an entire untrusted URL. */
export function interpolateUrl(template: string, vars: Record<string, unknown>): string {
  return substitute(template, vars, encodeURIComponent);
}

export function redactText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>")
    .replace(/\b(?:sk|pk|api|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi, "<redacted-secret>")
    .replace(/\b[A-F0-9]{32,}\b/gi, "<redacted-id>")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "<redacted-long-token>")
    .slice(0, 500);
}
