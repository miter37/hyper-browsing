export function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) throw new Error(`Missing variable: ${key}`);
    return String(value);
  });
}

export function redactText(value: string): string {
  return redactContent(value).slice(0, 500);
}

export function redactContent(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>")
    .replace(/\b(?:sk|pk|api|token|secret)[-_][A-Za-z0-9_-]{12,}\b/gi, "<redacted-secret>")
    .replace(/\b[A-F0-9]{32,}\b/gi, "<redacted-id>")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, "<redacted-long-token>");
}

export function redactUrl(value: string): string {
  return redactContent(value).replace(/([?&])([^=&#]+)=([^&#]*)/g,(match,prefix,key)=>{
    let decoded=key;try{decoded=decodeURIComponent(key.replace(/\+/g,' '));}catch{}
    return /password|secret|token|api.?key/i.test(decoded)?`${prefix}${key}=<redacted>`:match;
  });
}
