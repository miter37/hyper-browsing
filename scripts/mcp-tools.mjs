/**
 * Hyper-Browsing MCP tool contract. Thin adapter: all mutations and confirmation
 * checks are performed by the existing authenticated BrowserDaemon RPC.
 */
const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const B = (description) => ({ type: 'boolean', description });
const N = (description, minimum = 1, maximum = 50) => ({ type: 'integer', minimum, maximum, description });
const O = (description) => ({ type: 'object', description });
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tool = (name, description, properties, required, readOnly = false) => ({
  name, description, inputSchema: schema(properties, required),
  annotations: { readOnlyHint: readOnly, openWorldHint: true },
});
const sessionId = S('Session ID returned by session_open or session_list.');
const locator = O('One locator such as {"role":"button","name":"Search","exact":true} or {"css":"button.save"}.');
const ref = S('Current snapshot element reference, e.g. e27. Never reuse after navigation.');
const target = { locator, ref };
const confirmation = B('Set true ONLY after the user explicitly approved this external write. Never infer approval.');
const targetMessage = 'Provide exactly one of locator or ref, never both. Ambiguous targets are rejected; take a new snapshot.';

export const TOOLS = [
  tool('browser_status', 'Inspect local Chrome/browser daemon status and current sessions.', {}, [], true),
  tool('session_open', 'Open a browser tab and return its stable session ID.', { url: S('HTTP(S) URL to open.'), locale: S('Optional locale, e.g. ko-KR.'), viewport: S('Optional viewport, e.g. 1440x900.') }, ['url']),
  tool('session_list', 'List open browser tabs/sessions.', {}, [], true),
  tool('session_close', 'Close one session tab, not the whole browser.', {sessionId}, ['sessionId']),
  tool('snapshot', 'Compact observation of current page with short-lived element references.', {sessionId, query:S('Optional query for relevant controls.'), limit:N('Maximum elements to show.',1,100)}, ['sessionId'], true),
  tool('list_items', 'Extract repeated result cards and their titles/links.', {sessionId, query:S('Optional text filter.'), limit:N('Results per read.',1,50)}, ['sessionId'], true),
  tool('forms', 'Inspect visible form structure (labels, fields and submit buttons).', {sessionId}, ['sessionId'], true),
  tool('smart_scroll', 'Accumulate distinct visible list items across successive scrolls; no background action or auto-submission.', {sessionId, query:S('Optional text filter.'), rounds:N('Number of scroll rounds, max 8.',1,8), limit:N('Maximum aggregated items, max 100.',1,100)}, ['sessionId']),
  tool('dismiss_annoyances', 'Dismiss supported cookie banners and blocking popups using evidence-based UI rules (no forced hiding).', {sessionId}, ['sessionId']),
  tool('verify', 'Read-only assertions for the current page, returning APPLIED/NOT_APPLIED/UNKNOWN.', {sessionId, input:O('Verification JSON with a checks array (max 20).')}, ['sessionId','input'], true),
  tool('click', 'Click a uniquely identified current element. '+targetMessage, {sessionId,...target, confirmed:confirmation}, ['sessionId']),
  tool('fill', 'Fill one input, verify readback; submit is false by default. '+targetMessage, {sessionId,...target, value:S('Text to enter.'), submit:B('Submit with Enter after readback.'),confirmed:confirmation}, ['sessionId','value']),
  tool('select', 'Select one native/custom option. '+targetMessage, {sessionId,...target, option:S('Visible option label.')}, ['sessionId','option']),
  tool('press', 'Press a key on current focus or a given target; Enter can submit. '+targetMessage, {sessionId,...target,key:S('Playwright key, e.g. Enter or Escape.'),confirmed:confirmation}, ['sessionId','key']),
  tool('action_list', 'List saved actions for this page with lifecycle, risk and evidence.', {sessionId}, ['sessionId'], true),
  tool('run_saved_action', 'Run previously saved site action via shared risk/verification engine. External writes need explicit approval.', {sessionId, actionId:S('Existing saved action ID.'), siteId:S('Optional registered site ID.'), input:O('Action arguments.'), confirmed:confirmation}, ['sessionId','actionId']),
  tool('request_status', 'Inspect the result of a previous uncertain RPC request; never retransmit that request.', {requestId:S('Original RPC request ID.')}, ['requestId'], true),
];

const BY_NAME = new Map(TOOLS.map(t => [t.name,t]));
function typeOk(value, type) {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}
/** Independent of transport; preserves the daemon's input/risk checks. */
export function validateToolInput(name, value) {
  const t=BY_NAME.get(name);
  if (!t) throw new Error('Unknown MCP tool: '+name);
  if (!typeOk(value,'object')) throw new Error('Tool arguments must be an object');
  const {properties,required}=t.inputSchema;
  for (const key of required) if (value[key] === undefined) throw new Error('Missing argument: '+key);
  for (const [key,v] of Object.entries(value)) {
    if (!Object.hasOwn(properties,key)) throw new Error('Unknown argument: '+key);
    const s=properties[key];
    if (!typeOk(v,s.type)) throw new Error('Invalid type for '+key+': expected '+s.type);
    if (s.type==='string' && (v.length===0 || v.length>8192)) throw new Error('Invalid length for '+key);
    if (s.type==='integer' && (v<s.minimum || v>s.maximum)) throw new Error('Out of range: '+key);
  }
  if (Object.hasOwn(properties,'locator')) {
    const a=value.locator!==undefined,b=value.ref!==undefined;
    if (name==='press') { if(a&&b) throw new Error('Use locator or ref, not both'); }
    else if (a===b) throw new Error('Provide exactly one locator or ref');
    if (a) {
      const keys=['role','testId','text','label','placeholder','css'];
      if(keys.filter(k=>typeof value.locator[k]==='string'&&value.locator[k]).length!==1)throw new Error('Locator requires exactly one primary strategy');
    }
    if (b && !/^@?e\d+$/.test(value.ref))throw new Error('Invalid element ref');
  }
  if (name==='session_open' && !/^https?:\/\//i.test(value.url)) throw new Error('Only HTTP(S) navigation is accepted');
  if (name==='verify' && (!Array.isArray(value.input.checks) || value.input.checks.length>20)) throw new Error('verify.input.checks must be an array with at most 20 checks');
  return t;
}
const copy = (v,keys) => Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));
const actionArgs = v => ({...copy(v,['sessionId','locator','ref','value','option','key','submit','confirmed'])});
const rpc = (call,method,params) => call(method,params);

/** runTool returns the daemon result, not a synthesized claim of task success. */
export async function runTool(name,args,call) {
  validateToolInput(name,args);
  switch(name){
    case 'browser_status': return rpc(call,'browser.status',{});
    case 'session_open': return rpc(call,'session.open',copy(args,['url','viewport','locale']));
    case 'session_list': return rpc(call,'session.list',{});
    case 'session_close': return rpc(call,'session.close',copy(args,['sessionId']));
    case 'snapshot': return rpc(call,'page.snapshot',copy(args,['sessionId','query','limit']));
    case 'list_items': return rpc(call,'page.list',copy(args,['sessionId','query','limit']));
    case 'forms': return rpc(call,'page.forms',copy(args,['sessionId']));
    case 'dismiss_annoyances': return rpc(call,'page.dismissAnnoyances',{sessionId:args.sessionId,forceHide:false});
    case 'verify': return rpc(call,'page.verify',copy(args,['sessionId','input']));
    case 'click':return rpc(call,'page.click',actionArgs(args));
    case 'fill':return rpc(call,'page.fill',actionArgs(args));
    case 'select':return rpc(call,'page.select',actionArgs(args));
    case 'press':return rpc(call,'page.press',actionArgs(args));
    case 'action_list':return rpc(call,'action.list',{sessionId:args.sessionId});
    case 'run_saved_action':return rpc(call,'action.run',{sessionId:args.sessionId,actionId:args.actionId,siteId:args.siteId,input:args.input||{},confirmed:Boolean(args.confirmed)});
    case 'request_status':return rpc(call,'request.status',{requestId:args.requestId,verbose:true});
    case 'smart_scroll': {
      const collected=new Map(); const rounds=args.rounds||3, limit=args.limit||50, sessionId=args.sessionId;
      let last, partial=false;
      for(let i=0;i<=rounds;i++){
        const observed=await rpc(call,'page.list',{sessionId,query:args.query,limit:50});
        if (observed?.ok===false) return {ok:false,reason:'observation_failed',execution:observed.execution,detail:observed,items:[...collected.values()]};
        last=observed;
        for (const item of (observed?.items||[])) {
          const key=JSON.stringify([item.href||'',item.title||'',item.text||'']);
          if (!collected.has(key)) collected.set(key,item);
          if (collected.size>=limit) break;
        }
        if(collected.size>=limit || i===rounds)break;
        const scrolled=await rpc(call,'page.scroll',{sessionId,direction:'down',distance:850,times:1});
        if (scrolled?.ok===false) {partial=true;break;}
      }
      return {ok:!partial,found:collected.size>0,items:[...collected.values()].slice(0,limit),totalObserved:collected.size,lastContainer:last?.container,observationComplete:!partial};
    }
  }
  throw new Error('Unknown MCP tool: '+name);
}
