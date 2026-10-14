#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { postRpc } from './rpc-transport.mjs';
import {outputFormat} from './hwm-policy.mjs';

const FALLBACK_CODE = 42;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(process.env.WEBAGENT_RUNTIME_DIR || path.join(ROOT, ".runtime"));
const ENDPOINT_FILE = path.join(RUNTIME_DIR, "browserd-endpoint.json");
const TOKEN_FILE = path.join(RUNTIME_DIR, "browserd.token");

function getEndpointAndToken() {
  try {
    if (!fs.existsSync(ENDPOINT_FILE) || !fs.existsSync(TOKEN_FILE)) return null;
    const endpoint = JSON.parse(fs.readFileSync(ENDPOINT_FILE, "utf8"));
    const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (!endpoint?.port || !token) return null;
    return { port: Number(endpoint.port), token };
  } catch {
    return null;
  }
}

function parseArgs(args) {
  const flags = {};
  const boolFlags = new Set();
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        boolFlags.add(key);
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags, boolFlags };
}

function parseLocator(flags, boolFlags) {
  const exact = boolFlags.has("exact");
  if (flags.role || flags.name) return { role: flags.role, name: flags.name, exact };
  if (flags.testid) return { testId: flags.testid, exact };
  if (flags.text) return { text: flags.text, exact };
  if (flags.label) return { label: flags.label, exact };
  if (flags.placeholder) return { placeholder: flags.placeholder, exact };
  if (flags.css) return { css: flags.css, exact };
  return undefined;
}

function mapCommandToRpcBase(positionals, flags, boolFlags) {
  const [a, b, c] = positionals;
  if(['view','expand','inspect','changes'].includes(a)&&flags.session)return {method:'observation.'+a,params:{sessionId:flags.session,observation:flags.observation,comparison:flags.comparison,target:flags.target,format:flags.format,mode:flags.mode,focus:flags.focus,nodeBudget:flags['node-budget'],textBudget:flags['text-budget'],changeBudget:flags['change-budget']}};
  if(a==='verify'&&flags.session){const input=flags['input-file']?JSON.parse(fs.readFileSync(flags['input-file'],'utf8')):flags.input?JSON.parse(flags.input):{checks:[]};return {method:'page.verify',params:{sessionId:flags.session,input}};}
  if (a === 'request' && b === 'status' && flags.id) return { method: 'request.status', params: { requestId: flags.id } };

  if (a === "health") return { method: "health", params: {} };
  if (a === "browser" && b === "status") return { method: "browser.status", params: {} };

  if (a === "session" && b === "open") return { method: "session.open", params: { url: flags.url, viewport: flags.viewport, locale: flags.locale } };
  if (a === "session" && b === "list") return { method: "session.list", params: {} };
  if (a === "session" && b === "close") {
    if (boolFlags.has("all")) return { method: "session.closeAll", params: {} };
    if (flags.session) return { method: "session.close", params: { sessionId: flags.session } };
  }

  if (a === "snapshot" && flags.session) {
    return { method: "page.snapshot", params: { sessionId: flags.session, save: boolFlags.has("save"), query: flags.query, limit: flags.limit, context: boolFlags.has("context"), contextLimit: flags['context-limit'], format:flags.format } };
  }
  if(a==='diff'&&flags.session&&flags.before){return {method:'page.diff',params:{sessionId:flags.session,before:JSON.parse(flags.before.startsWith('{')?flags.before:fs.readFileSync(flags.before,'utf8')),context:boolFlags.has('context'),format:flags.format}};}

  if (a === "hover" && flags.session) {
    return {
      method: "page.hover",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        nth: flags.nth !== undefined ? Number(flags.nth) : undefined,
        within: flags.within,
        timeoutMs: flags["timeout-ms"] !== undefined ? Number(flags["timeout-ms"]) : undefined,
        force: boolFlags.has("force"),
        observe: boolFlags.has("observe"),
        query: flags.query,
      },
    };
  }

  if ((a === "back" || a === "forward") && flags.session) {
    return { method: a === "back" ? "page.back" : "page.forward", params: { sessionId: flags.session } };
  }

  if (a === "screenshot" && flags.session) {
    return { method: "page.screenshot", params: { sessionId: flags.session, fullPage: boolFlags.has("full-page") } };
  }

  if (a === "goto" && flags.session && flags.url) {
    return { method: "page.goto", params: { sessionId: flags.session, url: flags.url, observe: boolFlags.has("observe") } };
  }

  if (a === "click" && flags.session) {
    return {
      method: "page.click",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        nth: flags.nth !== undefined ? Number(flags.nth) : undefined,
        within: flags.within,
        timeoutMs: flags["timeout-ms"] !== undefined ? Number(flags["timeout-ms"]) : undefined,
        confirmed: boolFlags.has("confirm"),
        force: boolFlags.has("force"),
        observe: boolFlags.has("observe"),
      },
    };
  }

  if (a === "select" && flags.session && flags.option !== undefined) {
    return {
      method: "page.select",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        nth: flags.nth !== undefined ? Number(flags.nth) : undefined,
        within: flags.within,
        timeoutMs: flags["timeout-ms"] !== undefined ? Number(flags["timeout-ms"]) : undefined,
        option: flags.option,
        observe: boolFlags.has("observe"),
      },
    };
  }

  if (a === "list" && flags.session) {
    return { method: "page.list", params: { sessionId: flags.session, query: flags.query, limit: flags.limit } };
  }

  if (a === "fill" && flags.session && flags.value !== undefined) {
    return {
      method: "page.fill",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        nth: flags.nth !== undefined ? Number(flags.nth) : undefined,
        within: flags.within,
        timeoutMs: flags["timeout-ms"] !== undefined ? Number(flags["timeout-ms"]) : undefined,
        value: flags.value,
        submit: boolFlags.has("submit"),
        confirmed: boolFlags.has("confirm"),
        observe: boolFlags.has("observe"),
      },
    };
  }

  if (a === "press" && flags.session && flags.key) {
    return {
      method: "page.press",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        nth: flags.nth !== undefined ? Number(flags.nth) : undefined,
        within: flags.within,
        timeoutMs: flags["timeout-ms"] !== undefined ? Number(flags["timeout-ms"]) : undefined,
        key: flags.key,
        confirmed: boolFlags.has("confirm"),
        observe: boolFlags.has("observe"),
      },
    };
  }

  if (a === "extract" && flags.session) {
    return {
      method: "page.extract",
      params: {
        sessionId: flags.session,
        locator: parseLocator(flags, boolFlags),
        nth: flags.nth !== undefined ? Number(flags.nth) : undefined,
        within: flags.within,
        timeoutMs: flags["timeout-ms"] !== undefined ? Number(flags["timeout-ms"]) : undefined,
        read: flags.read || "text",
        attribute: flags.attribute,
        all: boolFlags.has("all"),
        limit: flags.limit,
        learn: boolFlags.has("learn"),
        requested: boolFlags.has("requested"),
      },
    };
  }

  if (a === "snapshot" && flags.session) {
    return { method: "page.snapshot", params: { sessionId: flags.session, save: boolFlags.has("save"), query: flags.query } };
  }

  if (a === "dismiss-annoyances" && flags.session) {
    return { method: "page.dismissAnnoyances", params: { sessionId: flags.session, forceHide: boolFlags.has("force-hide") } };
  }

  if (a === "wait-idle" && flags.session) {
    return { method: "page.waitForIdle", params: { sessionId: flags.session, timeoutMs: flags["timeout-ms"] ? Number(flags["timeout-ms"]) : undefined } };
  }

  if (a === "scroll" && flags.session) {
    return {
      method: "page.scroll",
      params: {
        sessionId: flags.session,
        direction: flags.direction || "down",
        distance: flags.distance ? Number(flags.distance) : undefined,
        times: flags.times ? Number(flags.times) : undefined,
        selector: flags.selector,
        delayMs: flags["delay-ms"] ? Number(flags["delay-ms"]) : undefined,
      },
    };
  }

  if (a === "wait-for" && flags.session) {
    return {
      method: "page.waitFor",
      params: {
        sessionId: flags.session,
        css: flags.css,
        text: flags.text,
        timeoutMs: flags["timeout-ms"] ? Number(flags["timeout-ms"]) : undefined,
        state: flags.state,
      },
    };
  }

  if (a === "eval" && flags.session && flags.expr) {
    return {
      method: "page.evaluate",
      params: {
        sessionId: flags.session,
        expression: flags.expr,
      },
    };
  }

  if (a === "learning" && b === "status" && flags.session) {
    return { method: "learning.status", params: { sessionId: flags.session } };
  }
  const input = () => flags['input-file'] ? JSON.parse(fs.readFileSync(path.resolve(flags['input-file']), 'utf8')) : flags.input ? JSON.parse(flags.input) : {};
  if (a === 'batch' && flags.session) return { method: 'batch.run', params: { sessionId: flags.session, input: input() } };
  if (a === 'learning' && b === 'finish' && flags.session) return { method: 'learning.finish', params: { sessionId: flags.session, input: input() } };
  if (a === 'learning' && b === 'notes' && flags.session) return { method: c === 'save' ? 'learning.notes.save' : 'learning.notes', params: { sessionId: flags.session, capability: flags.capability, input: c === 'save' ? input() : undefined } };
  if (a === 'learning' && b === 'action' && c === 'save' && flags.session) return { method: 'learning.action.save', params: { sessionId: flags.session, input: input() } };
  if (a === 'overview' && (b === 'save' || b === 'run') && flags.session) return { method: `overview.${b}`, params: { sessionId: flags.session, siteId: flags.site, input: b === 'save' ? input() : undefined } };
  if (a === 'asset' && (b === 'status' || b === 'report') && c && flags.session) return { method: `asset.${b}`, params: { sessionId: flags.session, siteId: flags.site, actionId: c, reason: flags.reason } };
  if (a === 'run' && b && flags.session) return { method: 'action.run', params: { sessionId: flags.session, actionId: b, siteId: flags.site, input: input(), confirmed: boolFlags.has('confirm') } };

  // Not a fast-path RPC command
  return null;
}
export function mapCommandToRpc(positionals, flags, boolFlags) {
  if (boolFlags.has('ref')) throw new Error('Missing --ref value. Use --ref e27, or quote the legacy value: --ref \'@e27\' (PowerShell treats bare @e27 as splatting).');
  const rpc = mapCommandToRpcBase(positionals, flags, boolFlags);
  if(rpc&&['page.snapshot','page.diff','page.click','page.hover','page.fill','page.select','page.press','batch.run'].includes(rpc.method))Object.assign(rpc.params,{mode:flags.mode,focus:flags.focus,nodeBudget:flags['node-budget'],textBudget:flags['text-budget'],changeBudget:flags['change-budget']});
  if(rpc&&['page.click','page.hover','page.fill','page.select','page.press','batch.run'].includes(rpc.method)){rpc.params.context=boolFlags.has('context');rpc.params.format=flags.format;}
  if (rpc && flags.ref) {
    if (!['page.click','page.hover','page.fill','page.select','page.press','page.extract'].includes(rpc.method)) throw new Error('This command does not accept --ref');
    if (['role','testid','text','label','placeholder','css','nth','within'].some(k=>flags[k]!==undefined) || boolFlags.has('all')) throw new Error('Use --ref alone; references cannot be indexed, scoped, or extracted with --all');
    rpc.params.ref = flags.ref.replace(/^@(?=e\d+$)/, ''); rpc.params.locator = undefined;
  }
  if(rpc)rpc.params.format=outputFormat(positionals[0],flags.format);
  return rpc;
}

async function main() {
  const { positionals, flags, boolFlags } = parseArgs(process.argv.slice(2));
  const rpc = mapCommandToRpc(positionals, flags, boolFlags);
  if (!rpc) process.exit(FALLBACK_CODE);
  rpc.params.verbose = boolFlags.has('verbose');
  const creds = getEndpointAndToken();
  if (!creds) {
    if (rpc.method !== 'request.status') process.exit(FALLBACK_CODE);
    console.log(JSON.stringify({ok:false,state:'unknown',execution:'outcome_unknown',hint:'Daemon unavailable; observe the page rather than resending.'})); process.exit(1);
  }
  const response = await postRpc({endpoint:`http://127.0.0.1:${creds.port}`,token:creds.token,...rpc});
  if (response.fallbackAllowed && rpc.method !== 'request.status') process.exit(FALLBACK_CODE);
  if(rpc.params.format==='hwm'&&typeof response.result?.hwm==='string')process.stdout.write(response.result.hwm);
  else process.stdout.write(JSON.stringify(response.result,null,2)+'\n');
  process.exit(!response.rpcOk || response.result?.ok === false ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1;
});
