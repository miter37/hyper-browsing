import os from "node:os";
import path from "node:path";

export interface AppConfig {
  root: string;
  runtimeDir: string;
  generatedDir: string;
  sitesDir: string;
  profileDir: string;
  port: number;
  host: string;
  headless: boolean;
  browserChannel?: string;
  cdpPort?: number;
  /**
   * Chrome profile to drive. Undefined means "auto": use the first profile Chrome knows
   * about. A name here pins a specific profile by directory ("Profile 1") or display name.
   */
  chromeProfileName?: string;
  /**
   * auto    - first profile, real directory when Chrome allows it, agent-owned mirror otherwise
   * managed - always an agent-owned directory (never touches the real profile)
   * real    - always the real Chrome profile directory (fails on Chrome 136+)
   */
  chromeProfileStrategy: "auto" | "managed" | "real";
  chromeProfileDirectory?: string;
  chromeUserDataDir?: string;
  chromeExecutable?: string;
  forceProfileTakeover: boolean;
  chromeStartupTimeoutMs: number;
  /**
   * Headless window size "W,H". Chrome's headless default (about 800x600) makes many sites switch to their mobile
   * layout, hiding desktop sidebars (filters) in drawers.
   */
  windowSize: string;
  /** Browser UI/Accept-Language, e.g. "en-US". Unset = Chrome's default (the OS language). */
  lang?: string;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function strEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function profileStrategy(): AppConfig["chromeProfileStrategy"] {
  const v = (strEnv("WEBAGENT_CHROME_PROFILE_STRATEGY") || "").toLowerCase();
  if (v === "managed") return "managed";
  // "existing" is the pre-0.3 spelling of "real"; keep it working.
  if (v === "real" || v === "existing") return "real";
  return "auto";
}

export function getConfig(): AppConfig {
  const root = path.resolve(process.env.WEBAGENT_HOME || process.cwd());
  const runtimeDir = path.resolve(process.env.WEBAGENT_RUNTIME_DIR || path.join(root, ".runtime"));
  return {
    root,
    runtimeDir,
    generatedDir: path.join(root, ".generated"),
    sitesDir: path.join(root, "sites"),
    profileDir: path.resolve(process.env.WEBAGENT_PROFILE_DIR || path.join(runtimeDir, "browser-profile")),
    port: Number(process.env.WEBAGENT_PORT || 3219),
    host: "127.0.0.1",
    // Headless by default: no visible window until something actually needs a human (login
    // wall, CAPTCHA, unexplained repeated failure). `webctl browser reveal` opens a visible
    // window on demand; `webctl browser hide` goes back to headless. That runtime choice
    // (persisted in .runtime/display-preference.json) always wins over this default - see
    // resolveHeadless() in chrome-manager.ts.
    headless: boolEnv("WEBAGENT_HEADLESS", true),
    browserChannel: process.env.WEBAGENT_BROWSER_CHANNEL || "chrome",
    cdpPort: process.env.WEBAGENT_CDP_PORT ? Number(process.env.WEBAGENT_CDP_PORT) : 9223,
    chromeProfileName: strEnv("WEBAGENT_CHROME_PROFILE_NAME"),
    chromeProfileStrategy: profileStrategy(),
    chromeProfileDirectory: strEnv("WEBAGENT_CHROME_PROFILE_DIRECTORY"),
    chromeUserDataDir: strEnv("WEBAGENT_CHROME_USER_DATA_DIR"),
    chromeExecutable: strEnv("WEBAGENT_CHROME_EXECUTABLE"),
    forceProfileTakeover: boolEnv("WEBAGENT_FORCE_PROFILE_TAKEOVER", true),
    chromeStartupTimeoutMs: Number(process.env.WEBAGENT_CHROME_STARTUP_TIMEOUT_MS || 20000),
    windowSize: /^\d{3,5},\d{3,5}$/.test(strEnv("WEBAGENT_WINDOW_SIZE") || "") ? strEnv("WEBAGENT_WINDOW_SIZE")! : "1440,900",
    lang: strEnv("WEBAGENT_LANG"),
  };
}

export const platformInfo = { platform: os.platform(), arch: os.arch() };
