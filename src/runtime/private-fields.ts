/** Shared DOM-side policy for snapshots, context and form discovery. */
export const PRIVATE_FIELD_SCRIPT = String.raw`function secret(el) {
  const auto=String(el.getAttribute('autocomplete')||'').toLowerCase();
  return el.type==='password'||auto.split(/\s+/).some(t=>t.startsWith('cc-')||t==='one-time-code')||
    /\b(cvc|cvv|otp|ssn)\b/i.test((el.name||'')+' '+(el.id||''))||
    /password|secret|token|api.?key/i.test([el.type,el.name,el.id,el.getAttribute('placeholder')].join(' '));
}`;
