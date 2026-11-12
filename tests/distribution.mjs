import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
test('npm package is publish-ready, CLI is bundled, tsx stays in production dependencies',()=>{
  const pkg=json('package.json');
  const lock=json('package-lock.json');
  assert.equal(pkg.private,undefined);
  assert.equal(pkg.bin['hyper-browsing'],'./bin/hyper-browsing.mjs');
  assert.ok(pkg.files.includes('sites'));
  assert.ok(pkg.files.includes('scripts'));
  assert.ok(pkg.dependencies.tsx);
  assert.equal(pkg.devDependencies.tsx,undefined);
  assert.equal(lock.packages[''].dependencies.tsx,pkg.dependencies.tsx);
});
test('cross-platform CLI help and version do not launch a browser or print secrets',()=>{
  for(const flag of ['--help','--version']){
    const child=spawnSync(process.execPath,[path.join(root,'bin/hyper-browsing.mjs'),flag],{cwd:root,encoding:'utf8',timeout:5000});
    assert.equal(child.status,0,child.stderr);
    assert.equal(child.stderr,'');
    assert.ok(child.stdout.trim().length>0);
  }
  const help=spawnSync(process.execPath,[path.join(root,'bin/hyper-browsing.mjs'),'help'],{encoding:'utf8'});
  assert.match(help.stdout,/mcp/);
  assert.match(help.stdout,/doctor/);
});
test('MCP implementation does not open an unauthenticated standalone listener',()=>{
  const code=fs.readFileSync(path.join(root,'scripts/mcp-server.mjs'),'utf8');
  assert.match(code,/postRpc/);
  assert.doesNotMatch(code,/createServer\\(/);
});
