import { findChromeExecutable } from '../src/browserd/chrome-manager.ts';
import { getConfig } from '../src/config.ts';

export function browserOptions() {
  let executablePath = process.env.PW_CHROMIUM_PATH;
  if (!executablePath) { try { executablePath = findChromeExecutable(getConfig()); } catch {} }
  return { headless: true, ...(executablePath ? { executablePath } : {}) };
}
