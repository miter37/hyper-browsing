/**
 * MCP tool catalog. All browser actions delegate to BrowserDaemon RPC instead
 * of creating a second Playwright control plane.
 */
const S = (maxLength = 1000) => ({ type: "string", minLength: 1, maxLength });
const B = { type: "boolean" };
const I = (min = 1, max = 100) => ({ type: "integer", minimum: min, maximum: max });
const O = (properties = {}, required = [], additionalProperties = false) => ({
  type: "object", properties, required, additionalProperties
});
const ID = S(100);
const URL_SCHEMA = { ...S(4096), description: "HTTP(S) URL" };
const LOCATOR = O({
  role: S(64), name: S(500), exact: B, testId: S(256),
  label: S(500), placeholder: S(500), text: S(500),
  css: S(1000), hasText: S(500), within: S(500)
});
const TARGET = { sessionId: ID, ref: S(100), locator: LOCATOR,
  nth: I(0, 100), within: S(500), timeoutMs: I(1, 30000) };
const SESSION = { sessionId: ID };
const definitions = [];

function add(name, title, description, properties, required, method, map, options = {}) {
  definitions.push({
    name, title, description,
    inputSchema: O(properties, required),
    annotations: {
      readOnlyHint: Boolean(options.readOnly),
      destructiveHint: Boolean(options.destructive),
      idempotentHint: Boolean(options.readOnly),
      openWorldHint: true
    },
    _method: method, _map: map, _autoStart: options.autoStart !== false,
    _target: Boolean(options.target), _approved: Boolean(options.approved),
    _urlField: options.urlField
  });
}

add("hb_health", "Health check", "Check the local Hyper-Browsing daemon. Chrome is started on first use if needed.",
  {}, [], "health", () => ({}), { readOnly: true });
add("hb_browser_status", "Browser status", "Inspect Chrome connection and active sessions.",
  {}, [], "browser.status", () => ({}), { readOnly: true });
add("hb_session_open", "Open browser session", "Open an isolated tab and return its sessionId. Login or CAPTCHA may require a visible Chrome window.",
  { url: URL_SCHEMA, viewport: S(30), locale: S(40) }, [], "session.open",
  a => ({ url: a.url, viewport: a.viewport, locale: a.locale }), { urlField: "url" });
add("hb_session_list", "List sessions", "List currently known tabs without closing or navigating them.",
  {}, [], "session.list", () => ({}), { readOnly: true });
add("hb_session_close", "Close one session", "Close ONLY the specified tab. Requires approved=true after the user authorizes closing it.",
  { ...SESSION, approved: B }, ["sessionId", "approved"], "session.close",
  a => ({ sessionId: a.sessionId }), { destructive: true, approved: true });
add("hb_goto", "Navigate", "Navigate the specified session to a concrete HTTP(S) URL.",
  { ...SESSION, url: URL_SCHEMA }, ["sessionId", "url"], "page.goto",
  a => ({ sessionId: a.sessionId, url: a.url }), { urlField: "url" });
add("hb_snapshot", "Inspect interactive elements", "Compact, structured DOM snapshot with ephemeral refs; passwords and card fields are masked.",
  { ...SESSION, query: S(300), limit: I(1, 200) }, ["sessionId"], "page.snapshot",
  a => ({ sessionId: a.sessionId, query: a.query, limit: a.limit }), { readOnly: true });
add("hb_forms", "Inspect forms", "Inspect form fields, labels, required flags, selection state and submit buttons.",
  SESSION, ["sessionId"], "page.forms", a => ({ sessionId: a.sessionId }), { readOnly: true });
add("hb_list", "Inspect repeated items", "Extract compact titles, links and text from a repeated list on the current page.",
  { ...SESSION, query: S(200), limit: I(1, 50) }, ["sessionId"], "page.list",
  a => ({ sessionId: a.sessionId, query: a.query, limit: a.limit }), { readOnly: true });
add("hb_smart_scroll", "Accumulate virtualized lists", "Scroll a bounded number of times, collecting uniquely observed item excerpts before virtual DOM unmounts them.",
  { ...SESSION, query: S(200), maxScrolls: I(1, 10), limit: I(1, 100), distance: I(100, 3000), selector: S(1000) },
  ["sessionId"], "page.smartScroll",
  a => ({ sessionId: a.sessionId, query: a.query, maxScrolls: a.maxScrolls, limit: a.limit, distance: a.distance, selector: a.selector }));
add("hb_scroll", "Scroll page", "Scroll a page or a CSS-selected scroll container without taking another action.",
  { ...SESSION, direction: { type: "string", enum: ["up", "down"] }, distance: I(50, 4000), times: I(1, 10), selector: S(1000) },
  ["sessionId"], "page.scroll",
  a => ({ sessionId: a.sessionId, direction: a.direction, distance: a.distance, times: a.times, selector: a.selector }));
add("hb_dismiss_annoyances", "Dismiss verified overlays", "Dismiss only evidenced consent/close controls; never force-hide overlays or bypass human verification.",
  SESSION, ["sessionId"], "page.dismissAnnoyances", a => ({ sessionId: a.sessionId, forceHide: false }));
add("hb_click", "Click observed element", "Click a unique pinned ref or semantic locator; the daemon refuses ambiguous targets and requests confirmation for writes.",
  { ...TARGET, confirmed: B, observe: B }, ["sessionId"], "page.click",
  a => ({ ...a, confirmed: a.confirmed === true }), { target: true });
add("hb_hover", "Hover element", "Reveal hover menus, with the same unique-target checks.",
  TARGET, ["sessionId"], "page.hover", a => a, { target: true });
add("hb_fill", "Fill field", "Fill a field with read-back verification. Set submit=true ONLY when submission is intended; writes require confirmation.",
  { ...TARGET, value: { type: "string", maxLength: 20000 }, submit: B, confirmed: B },
  ["sessionId", "value"], "page.fill", a => ({ ...a, confirmed: a.confirmed === true }), { target: true });
add("hb_select", "Select option", "Choose a unique option. Some sites autosave when changed; inspect and verify the effect.",
  { ...TARGET, option: S(2000), confirmed: B }, ["sessionId", "option"], "page.select",
  a => ({ ...a, confirmed: a.confirmed === true }), { target: true });
add("hb_press", "Press key", "Press a key on the pinned element, or the focused element when no locator/ref is supplied; Enter respects write confirmation.",
  { ...TARGET, key: S(100), confirmed: B }, ["sessionId", "key"], "page.press",
  a => ({ ...a, confirmed: a.confirmed === true }));
add("hb_verify", "Verify observed result", "Read-only verification of up to 20 explicit checks (APPLIED, NOT_APPLIED or UNKNOWN); does not repeat writes.",
  { ...SESSION, checks: { type: "array", maxItems: 20, items: { type: "object" } } },
  ["sessionId", "checks"], "page.verify", a => ({ sessionId: a.sessionId, input: { checks: a.checks } }), { readOnly: true });
add("hb_action_list", "List reusable actions", "List saved site actions with scope, evidence, lifecycle, risk and availability.",
  SESSION, ["sessionId"], "action.list", a => ({ sessionId: a.sessionId }), { readOnly: true });
add("hb_action_run", "Run saved action", "Run an existing site action using daemon confirmation and verification. Local code actions are disabled unless the operator opts in.",
  { ...SESSION, actionId: S(128), siteId: S(128), input: O({}, [], true), confirmed: B },
  ["sessionId", "actionId"], "action.run",
  a => ({ sessionId: a.sessionId, actionId: a.actionId, siteId: a.siteId, input: a.input || {}, confirmed: a.confirmed === true }));
add("hb_request_status", "Check request outcome", "Lookup an existing requestId after an uncertain response. Never replays the original command.",
  { requestId: ID }, ["requestId"], "request.status",
  a => ({ requestId: a.requestId, verbose: true }), { readOnly: true, autoStart: false });
add("hb_browser_reveal", "Show Chrome for human input", "Switch to visible Chrome for user login, CAPTCHA or 2FA. This relaunches Chrome; requires approved=true.",
  { approved: B }, ["approved"], "browser.reveal", () => ({}), { approved: true });
add("hb_browser_hide", "Hide Chrome", "Return to headless Chrome. This relaunches Chrome; requires approved=true.",
  { approved: B }, ["approved"], "browser.hide", () => ({}), { approved: true });

export const toolCatalog = definitions.map(({ _method, _map, _autoStart, _target, _approved, _urlField, ...info }) => info);

function fail(message) { throw new TypeError(message); }
function validate(schema, value, where) {
  if (schema === undefined) return;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(where + " must be an object");
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(where + "." + key + " is required");
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) {
        if (schema.additionalProperties === false) fail(where + "." + key + " is not supported");
        continue;
      }
      validate(schema.properties[key], item, where + "." + key);
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string" || (schema.minLength && value.length < schema.minLength) ||
      (schema.maxLength && value.length > schema.maxLength)) fail(where + " must be a valid string");
    if (schema.enum && !schema.enum.includes(value)) fail(where + " must be one of " + schema.enum.join(", "));
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") fail(where + " must be a boolean");
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum)) fail(where + " must be a bounded integer");
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || (schema.maxItems !== undefined && value.length > schema.maxItems)) fail(where + " must be a bounded array");
    for (const [i, item] of value.entries()) validate(schema.items, item, where + "[" + i + "]");
  }
}

function validateTarget(a) {
  const hasRef = typeof a.ref === "string";
  const hasLocator = a.locator && typeof a.locator === "object";
  if (Boolean(hasRef) === Boolean(hasLocator)) fail("Provide exactly one of ref or locator");
  if (hasRef && (a.nth !== undefined || a.within !== undefined)) fail("A pinned ref cannot be scoped or indexed");
  if (hasLocator) {
    const primary = ["role", "testId", "label", "placeholder", "text", "css"].filter(k => a.locator[k] !== undefined);
    if (primary.length !== 1) fail("Locator must have exactly one primary strategy");
    if (a.locator.hasText !== undefined && !a.locator.css) fail("Locator hasText requires css");
  }
}
function validateUrl(url) {
  if (!url) return;
  let parsed;
  try { parsed = new URL(url); } catch { fail("URL must be absolute HTTP(S)"); }
  if (!["http:", "https:"].includes(parsed.protocol)) fail("Only HTTP(S) URLs are supported");
}

export function toolCall(name, args = {}) {
  const def = definitions.find(d => d.name === name);
  if (!def) fail("Unknown tool: " + name);
  validate(def.inputSchema, args, "arguments");
  if (def._target) validateTarget(args);
  if (def._approved && args.approved !== true) fail("Explicit user approval required: approved=true");
  if (def._urlField) validateUrl(args[def._urlField]);
  return { method: def._method, params: def._map(args), autoStart: def._autoStart };
}
