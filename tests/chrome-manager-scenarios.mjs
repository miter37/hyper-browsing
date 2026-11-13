#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch {
  const cp = require('node:child_process');
  const globalRoot = cp.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
  ts = require(path.join(globalRoot, 'typescript'));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'awa-scenario-'));
const modDir = path.join(tmp, 'mod');
await fs.mkdir(path.join(modDir, 'node_modules', 'playwright'), { recursive: true });

const source = await fs.readFile(path.join(root, 'src/browserd/chrome-manager.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
await fs.writeFile(path.join(modDir, 'chrome-manager.cjs'), js);

// Minimal Playwright stub. ChromeManager only needs connectOverCDP for these lifecycle tests.
await fs.writeFile(path.join(modDir, 'node_modules', 'playwright', 'index.js'), `
exports.chromium = {
  connectOverCDP: async () => {
    let connected = true; const handlers = {};
    return {
      on: (n, cb) => { handlers[n] = cb; },
      isConnected: () => connected,
      contexts: () => [{ pages: () => [], addInitScript: async () => {} }],
      __disconnect: () => { connected = false; handlers.disconnected && handlers.disconnected(); }
    };
  }
};
`);

const manager = require(path.join(modDir, 'chrome-manager.cjs'));

function config(runtimeDir, overrides = {}) {
  return {
    root, runtimeDir, generatedDir: path.join(runtimeDir, 'generated'), sitesDir: path.join(runtimeDir, 'sites'),
    profileDir: path.join(runtimeDir, 'old-profile'), port: 3219, host: '127.0.0.1', headless: false,
    browserChannel: 'chrome', cdpPort: 19223, chromeProfileName: undefined, chromeProfileStrategy: 'managed',
    chromeProfileDirectory: undefined, chromeUserDataDir: undefined, chromeExecutable: undefined,
    forceProfileTakeover: true, chromeStartupTimeoutMs: 5000, ...overrides
  };
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e?.stack || String(e) }); }
}

/* ---------------------------------------------------------------- *
 * Profile resolution
 * ---------------------------------------------------------------- */

await test('auto mode with no profile name resolves the first Chrome profile', async () => {
  const rt = path.join(tmp, 'rt-auto'); await fs.mkdir(rt, { recursive: true });
  const profiles = await manager.listChromeProfiles();
  const p = await manager.resolveChromeProfile(config(rt, { chromeProfileStrategy: 'auto' }));
  if (p.requestedName !== '(first profile)') throw new Error(`requestedName=${p.requestedName}`);
  if (profiles.length && p.basedOn && p.basedOn.directory !== profiles[0].directory) {
    throw new Error(`expected first profile ${profiles[0].directory}, got ${p.basedOn.directory}`);
  }
  if (!p.reason) throw new Error('resolution must explain itself');
});

await test('listChromeProfiles orders Default first, then Profile 2 before Profile 10', async () => {
  const profiles = await manager.listChromeProfiles();
  const dirs = profiles.map((x) => x.directory);
  const idx = (d) => dirs.indexOf(d);
  if (idx('Default') > 0 && idx('Profile 1') >= 0 && idx('Default') > idx('Profile 1')) {
    throw new Error(`Default must sort first: ${dirs.join(', ')}`);
  }
  if (idx('Profile 2') >= 0 && idx('Profile 10') >= 0 && idx('Profile 2') > idx('Profile 10')) {
    throw new Error(`numeric ordering broken: ${dirs.join(', ')}`);
  }
});

await test('managed mode uses an agent-owned directory under .runtime', async () => {
  const rt = path.join(tmp, 'rt1'); await fs.mkdir(rt, { recursive: true });
  const p = await manager.resolveChromeProfile(config(rt));
  if (!p.managed) throw new Error('expected managed=true');
  if (!p.userDataDir.startsWith(path.join(rt, 'chrome-profiles'))) throw new Error(p.userDataDir);
  if (p.profileDirectory !== 'Default') throw new Error(p.profileDirectory);
  const prefs = JSON.parse(await fs.readFile(path.join(p.userDataDir, 'Default', 'Preferences'), 'utf8'));
  if (!prefs.profile.name) throw new Error('profile display name not seeded');
});

await test('an explicit profile name labels the managed directory', async () => {
  const rt = path.join(tmp, 'rt-name'); await fs.mkdir(rt, { recursive: true });
  const p = await manager.resolveChromeProfile(config(rt, { chromeProfileName: 'work-profile' }));
  if (p.requestedName !== 'work-profile') throw new Error(p.requestedName);
  if (!p.userDataDir.includes('work-profile-user-data')) throw new Error(p.userDataDir);
});

await test('auto/real mode rejects an unknown profile name with the list of known ones', async () => {
  const rt = path.join(tmp, 'rt-bad'); await fs.mkdir(rt, { recursive: true });
  let message = '';
  try {
    await manager.resolveChromeProfile(config(rt, { chromeProfileStrategy: 'auto', chromeProfileName: 'definitely-not-a-profile' }));
  } catch (e) { message = String(e.message || e); }
  if (!message.includes('No Chrome profile matches')) throw new Error(`unexpected error: ${message}`);
  if (!message.includes('browser profiles')) throw new Error('error must point at the recovery command');
});

await test('explicit custom user-data dir wins', async () => {
  const rt = path.join(tmp, 'rt2'); const ud = path.join(tmp, 'custom-user-data'); await fs.mkdir(ud, { recursive: true });
  const p = await manager.resolveChromeProfile(config(rt, { chromeUserDataDir: ud, chromeProfileDirectory: 'Profile 9' }));
  if (p.source !== 'explicit' || p.profileDirectory !== 'Profile 9') throw new Error(JSON.stringify(p));
});

/* ---------------------------------------------------------------- *
 * Never closing the user's own Chrome
 * ---------------------------------------------------------------- */

await test('an agent-owned directory never matches the user\'s ordinary Chrome', async () => {
  const roots = manager.chromeRoots();
  const agentDir = path.join(tmp, 'rt-match', 'chrome-profiles', 'Profile-1-user-data');
  const personal = process.platform === 'win32'
    ? '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --flag-switches-begin --flag-switches-end'
    : '/opt/google/chrome/chrome --enable-crashpad';
  const agentChrome = process.platform === 'win32'
    ? `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9223 --user-data-dir=${agentDir} --profile-directory=Default`
    : `/opt/google/chrome/chrome --remote-debugging-port=9223 --user-data-dir=${agentDir} --profile-directory=Default`;

  // The decisive case: ordinary Chrome must NOT be claimed by an agent-owned directory.
  if (manager.commandTargetsUserDataDir(personal, agentDir)) {
    throw new Error("the user's own Chrome was matched against an agent-owned directory");
  }
  if (!manager.commandTargetsUserDataDir(agentChrome, agentDir)) {
    throw new Error('the agent failed to recognise its own Chrome');
  }
  // Ordinary Chrome does match a real root, so the caller knows to back off instead of killing.
  if (!manager.commandTargetsUserDataDir(personal, roots[0])) {
    throw new Error('ordinary Chrome must be detected on the real profile root');
  }
  // A different agent-owned directory must not match either.
  const otherDir = path.join(tmp, 'rt-match', 'chrome-profiles', 'Profile-2-user-data');
  if (manager.commandTargetsUserDataDir(agentChrome, otherDir)) {
    throw new Error('matched an unrelated agent-owned directory');
  }
  // A non-Chrome process is never a candidate.
  if (manager.commandTargetsUserDataDir(`node server.js --user-data-dir=${agentDir}`, agentDir)) {
    throw new Error('a non-Chrome process was matched');
  }
});

await test('a real profile held by another Chrome is reported, never killed', async () => {
  const rt = path.join(tmp, 'rt-real'); await fs.mkdir(rt, { recursive: true });
  const roots = manager.chromeRoots();
  const realProfile = {
    requestedName: '(first profile)', userDataDir: roots[0], profileDirectory: 'Default',
    displayName: 'Default', managed: false, source: 'real-chrome-profile', reason: 'test',
  };
  const result = await manager.forceReleaseChromeProfile(config(rt), realProfile);
  if (result.killed.length) throw new Error(`killed the user's Chrome: ${JSON.stringify(result.killed)}`);
  if (result.locksRemoved.length) throw new Error('must not touch locks in a real profile root');
});

await test('stale Singleton locks are removed from an agent-owned directory', async () => {
  const rt = path.join(tmp, 'rt3'); await fs.mkdir(rt, { recursive: true });
  const p = await manager.resolveChromeProfile(config(rt));
  for (const n of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) await fs.writeFile(path.join(p.userDataDir, n), 'stale');
  const r = await manager.forceReleaseChromeProfile(config(rt), p);
  if (r.locksRemoved.length !== 3) throw new Error(JSON.stringify(r));
});

await test('Chrome holding the agent-owned directory is force-terminated', async () => {
  if (process.platform === 'win32') return; // exec -a is POSIX-only; the Windows path is taskkill.
  const rt = path.join(tmp, 'rt4'); await fs.mkdir(rt, { recursive: true });
  const p = await manager.resolveChromeProfile(config(rt));
  const child = spawn('bash', ['-lc', `exec -a 'google-chrome --user-data-dir=${p.userDataDir} --profile-directory=Default' sleep 60`], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 250));
  const r = await manager.forceReleaseChromeProfile(config(rt), p);
  if (!r.killed.includes(child.pid)) throw new Error(`did not kill ${child.pid}: ${JSON.stringify(r)}`);
});

/* ---------------------------------------------------------------- *
 * Lifecycle
 * ---------------------------------------------------------------- */

function freeServer(port) {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => resolve(s)); });
}

async function fakeChromeScript(file) {
  await fs.writeFile(file, `#!/usr/bin/env node\nconst http=require('http');\nlet port=0; for(const a of process.argv.slice(2)){ if(a.startsWith('--remote-debugging-port=')) port=Number(a.split('=')[1]); }\nif(!port) process.exit(3);\nconst s=http.createServer((req,res)=>{ if(req.url==='/json/version'){res.setHeader('content-type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/devtools/browser/fake'}));}else{res.statusCode=404;res.end();}});\ns.listen(port,'127.0.0.1'); process.on('SIGTERM',()=>s.close(()=>process.exit(0))); setInterval(()=>{},10000);\n`, { mode: 0o755 });
}

await test('a successful launcher exit waits for the browser CDP handoff', async () => {
  const reserved=await freeServer(0);const port=reserved.address().port;
  await new Promise(resolve=>reserved.close(resolve));
  const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://handoff'}));});
  const cp=require('node:child_process');const originalSpawn=cp.spawn;let timer;
  cp.spawn=()=>{
    const child=new EventEmitter();child.exitCode=0;child.unref=()=>{};
    process.nextTick(()=>child.emit('spawn'));
    timer=setTimeout(()=>server.listen(port,'127.0.0.1'),400);
    return child;
  };
  try{
    const rt=path.join(tmp,'rt-handoff');
    const cm=new manager.ChromeManager(config(rt,{headless:true,cdpPort:port}));
    const started=await cm.launch(process.execPath,{userDataDir:path.join(rt,'profile'),profileDirectory:'Default',managed:true},{});
    if(!started.state.headless || started.state.headedFallback)throw new Error('A successful launcher handoff must not switch display modes');
  }finally{
    cp.spawn=originalSpawn;clearTimeout(timer);
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
  }
});

await test('occupied preferred CDP port falls forward and Chrome survives manager stop', async () => {
  if (process.platform === 'win32') return; // the fake Chrome relies on a POSIX shebang.
  const rt = path.join(tmp, 'rt5'); await fs.mkdir(rt, { recursive: true });
  const fake = path.join(tmp, 'google-chrome'); await fakeChromeScript(fake); await fs.chmod(fake, 0o755);
  const blocker = await freeServer(19223);
  const cfg = config(rt, { chromeExecutable: fake, cdpPort: 19223 });
  const cm = new manager.ChromeManager(cfg);
  const started = await cm.start();
  if (started.state.cdpPort !== 19224) throw new Error(`expected 19224 got ${started.state.cdpPort}`);
  const pid = started.state.pid;
  await cm.stop();
  let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
  if (!alive) throw new Error('Chrome was killed by manager.stop()');
  blocker.close();
  try { process.kill(pid, 'SIGTERM'); } catch {}
});

await test('browserd restart path reuses the already-running Chrome instead of killing it', async () => {
  if (process.platform === 'win32') return;
  const rt = path.join(tmp, 'rt6'); await fs.mkdir(rt, { recursive: true });
  const fake = path.join(tmp, 'google-chrome-reuse'); await fakeChromeScript(fake); await fs.chmod(fake, 0o755);
  const cfg = config(rt, { chromeExecutable: fake, cdpPort: 19323 });
  const first = new manager.ChromeManager(cfg); const a = await first.start(); await first.stop();
  const second = new manager.ChromeManager(cfg); const b = await second.start();
  if (!b.takeover?.reusedExistingChrome) throw new Error(JSON.stringify(b.takeover));
  if (a.state.pid !== b.state.pid) throw new Error('Chrome pid changed unexpectedly');
  try { process.kill(a.state.pid, 'SIGTERM'); } catch {}
});

await test('concurrent start() calls do not race-kill each other', async () => {
  // Reproduces the real failure this guards against: two ChromeManagers targeting the same
  // profile, starting at the same moment, each treating the other's freshly-launched Chrome
  // as a stale conflict and killing it - Chrome opening and immediately closing, repeatedly,
  // never stabilizing. The startup lock serializes them instead: the second must wait for the
  // first to finish and then simply reattach to what it launched.
  if (process.platform === 'win32') return;
  const rt = path.join(tmp, 'rt9'); await fs.mkdir(rt, { recursive: true });
  const fake = path.join(tmp, 'google-chrome-race'); await fakeChromeScript(fake); await fs.chmod(fake, 0o755);
  const cfg = config(rt, { chromeExecutable: fake, cdpPort: 19423 });
  const a = new manager.ChromeManager(cfg);
  const b = new manager.ChromeManager(cfg);
  const [ra, rb] = await Promise.all([a.start(), b.start()]);
  if (ra.state.pid !== rb.state.pid) {
    throw new Error(`two managers ended up with different Chrome processes (${ra.state.pid} vs ${rb.state.pid}) - the race was not prevented`);
  }
  const reused = [ra.takeover, rb.takeover].filter((t) => t?.reusedExistingChrome).length;
  if (reused !== 1) throw new Error(`expected exactly one manager to reattach, got ${reused}: ${JSON.stringify([ra.takeover, rb.takeover])}`);
  try { process.kill(ra.state.pid, 'SIGTERM'); } catch {}
});

await test('profile preference round-trips and --auto clears it', async () => {
  const rt = path.join(tmp, 'rt7'); await fs.mkdir(rt, { recursive: true });
  const cm = new manager.ChromeManager(config(rt));
  const saved = await cm.writePreference({ profileName: 'Profile 3', mode: 'managed' });
  if (saved.profileName !== 'Profile 3' || saved.mode !== 'managed') throw new Error(JSON.stringify(saved));
  if ((await cm.readPreference()).profileName !== 'Profile 3') throw new Error('preference did not persist');
  await cm.writePreference({});
  if (Object.keys(await cm.readPreference()).length !== 0) throw new Error('--auto must clear the preference');
});

await test('headless defaults to config, and reveal/hide override it and can be cleared', async () => {
  const rt = path.join(tmp, 'rt8'); await fs.mkdir(rt, { recursive: true });
  const cfg = config(rt, { headless: true });
  const cm = new manager.ChromeManager(cfg);
  if ((await manager.resolveHeadless(cfg)) !== true) throw new Error('should default to config.headless (true)');

  await cm.writeDisplayPreference({ headless: false });
  if ((await manager.resolveHeadless(cfg)) !== false) throw new Error('browser reveal (headless:false) did not override the default');

  await cm.writeDisplayPreference({ headless: true });
  if ((await manager.resolveHeadless(cfg)) !== true) throw new Error('browser hide (headless:true) did not persist');

  await cm.writeDisplayPreference({});
  if ((await manager.resolveHeadless(cfg)) !== true) throw new Error('clearing the preference should fall back to config.headless');
  if (Object.keys(await cm.readDisplayPreference()).length !== 0) throw new Error('cleared preference file should be empty');
});

const failed = results.filter(x => !x.ok);
console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed }, null, 2));
await fs.rm(tmp, { recursive: true, force: true });
if (failed.length) process.exit(1);
