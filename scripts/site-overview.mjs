import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export async function runOverviewCli(siteId) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  if (!args.includes('--session')) {
    console.error('탐색할 작업 세션이 필요합니다: --session ID');
    process.exitCode = 1; return;
  }
  const command = ['overview', 'run', '--site', siteId, ...args];
  let result = spawnSync(process.execPath, [path.join(root, 'scripts/webctl-rpc.mjs'), ...command], { stdio: 'inherit', windowsHide: true });
  if (result.status === 42) result = spawnSync(process.execPath, [path.join(root, 'scripts/launcher.mjs'), 'webctl', ...command], { stdio: 'inherit', windowsHide: true });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
