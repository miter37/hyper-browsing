import fs from "node:fs/promises";

// Defense in depth only: a code action executes in Node and is never a sandbox.
// The action runner requires explicit confirmation before loading these modules.
const forbidden = [
  { re: /\b(?:from\s+|require\s*\(\s*|import\s*\(\s*)["'`](?:node:)?(?:child_process|fs(?:\/promises)?|net|tls|dgram|http|https|vm|module|worker_threads)(?:\/[^"'`]*)?["'`]/, reason: "privileged Node modules are forbidden in site actions" },
  { re: /\b(?:import\s*\(|require\s*\()/, reason: "dynamic imports and require are forbidden in site actions" },
  { re: /\b(?:eval|Function)\s*\(/, reason: "dynamic code execution is forbidden in site actions" },
  { re: /\b(?:globalThis\s*(?:\.|\[)|process\s*(?:\.|\[))/, reason: "global process access is forbidden in site actions" },
  { re: /\bfetch\s*\(/, reason: "external fetch is forbidden in site actions; use the page/browser context" },
  { re: /\b(?:exec|execFile|spawn|fork)\s*\(/, reason: "process execution is forbidden in site actions" },
];

export async function scanActionFile(file: string): Promise<void> {
  const source = await fs.readFile(file, "utf8");
  for (const rule of forbidden) {
    if (rule.re.test(source)) throw new Error(`Security scan rejected ${file}: ${rule.reason}`);
  }
}
