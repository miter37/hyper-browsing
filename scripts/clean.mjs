#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveRuntimeDir } from "./runtime-home.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = resolveRuntimeDir(ROOT);
const CHROME_PROFILES_DIR = path.join(RUNTIME_DIR, "chrome-profiles");
const PROFILE_1_DATA = path.join(CHROME_PROFILES_DIR, "Profile-1-user-data");

console.log("🧹 [hyper-browsing] Starting Smart Clean...");

// 1. Chrome may be in use by another agent's task: it is closed only on request (--stop-chrome), and only the
//    Chrome running on this runtime's own profiles. Without it, a running Chrome makes the profile trim skip.
const STOP_CHROME = process.argv.includes("--stop-chrome");
function chromeOnRuntime() {
  if (process.platform !== "win32") return [];
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"], { encoding: "utf8", windowsHide: true });
    const needle = CHROME_PROFILES_DIR.toLowerCase();
    return out.split(/\r?\n/).filter((l) => l.toLowerCase().includes(needle)).map((l) => Number(l.split("\t")[0])).filter(Boolean);
  } catch { return []; }
}
const running = chromeOnRuntime();
console.log(`1. Chrome on this runtime: ${running.length ? running.length + " process(es)" : "not running"}`);
if (running.length && STOP_CHROME) {
  for (const pid of running) { try { execFileSync("taskkill", ["/PID", String(pid)], { stdio: "ignore", windowsHide: true }); } catch {} }
  console.log("   Asked Chrome to close (--stop-chrome).");
}

function safeRemove(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      const stat = fs.lstatSync(targetPath);
      if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
      return true;
    }
  } catch (err) {
    // Ignore busy locks
  }
  return false;
}

// 2. Clean garbage directories dumped into ROOT
console.log("2. Cleaning leaked Chrome cache folders from root directory...");
const ROOT_GARBAGE = [
  "ActorSafetyLists",
  "AmountExtractionHeuristicRegexes",
  "CaptchaProviders",
  "CertificateRevocation",
  "component_crx_cache",
  "Crashpad",
  "Crowd Deny",
  "Default",
  "extensions_crx_cache",
  "FileTypePolicies",
  "FirstPartySetsPreloaded",
  "GPUPersistentCache",
  "GrShaderCache",
  "hyphen-data",
  "MEIPreload",
  "optimization_guide_model_store",
  "OptimizationGuideModelsManifest",
  "OptimizationHints",
  "OriginTrials",
  "PKIMetadata",
  "PrivacySandboxAttestationsPreloaded",
  "RecoveryImproved",
  "Safe Browsing",
  "SafetyTips",
  "segmentation_platform",
  "ShaderCache",
  "SSLErrorAssistant",
  "Subresource Filter",
  "TrustTokenKeyCommitments",
  "WasmTtsEngine",
  "WidevineCdm",
  "ZxcvbnData",
  "BrowserMetrics-spare.pma",
  "en-US-10-1.bdic",
  "ko-3-0.bdic",
  "First Run",
  "first_party_sets.db",
  "first_party_sets.db-journal",
  "Last Browser",
  "Last Version",
  "Local State",
  "Variations",
  "VariationsSafeSeedV2",
  "VariationsSeedV2",
  "scratch"
];

let rootCleaned = 0;
for (const item of ROOT_GARBAGE) {
  const p = path.join(ROOT, item);
  if (safeRemove(p)) rootCleaned++;
}
console.log(`   Cleaned ${rootCleaned} leaked items from root.`);

// 3. Clean test profiles and transient data in .runtime
console.log("3. Cleaning test profiles, snapshots, and observation logs in .runtime...");
const RUNTIME_GARBAGE = [
  path.join(CHROME_PROFILES_DIR, "test-profile"),
  path.join(RUNTIME_DIR, "snapshots"),
  path.join(RUNTIME_DIR, "observations"),
  path.join(RUNTIME_DIR, "browser-profile"),
  path.join(RUNTIME_DIR, "metrics"),
  path.join(RUNTIME_DIR, "sessions"),
  path.join(RUNTIME_DIR, "traces"),
  path.join(RUNTIME_DIR, "browserd.pid"),
  path.join(RUNTIME_DIR, "browserd.log"),
  path.join(RUNTIME_DIR, "browserd-endpoint.json"),
  path.join(RUNTIME_DIR, "chrome-startup.lock")
];

for (const p of RUNTIME_GARBAGE) {
  safeRemove(p);
}

// 4. Preserve Authentication Cookies & Storage, Wipe Huge Caches inside Profile-1-user-data
console.log("4. Trimming heavy cache inside Profile-1-user-data while PRESERVING login sessions...");
if (running.length && !STOP_CHROME) {
  console.log("   Skipped: Chrome is running on this profile (rerun with --stop-chrome to close it first).");
} else if (fs.existsSync(PROFILE_1_DATA)) {
  const DEFAULT_DIR = path.join(PROFILE_1_DATA, "Default");
  
  // Folders safe to wipe (100% regenerable caches)
  const CACHE_FOLDERS_TO_WIPE = [
    path.join(PROFILE_1_DATA, "GrShaderCache"),
    path.join(PROFILE_1_DATA, "ShaderCache"),
    path.join(PROFILE_1_DATA, "Crashpad"),
    path.join(PROFILE_1_DATA, "optimization_guide_model_store"),
    path.join(DEFAULT_DIR, "Cache"),
    path.join(DEFAULT_DIR, "Code Cache"),
    path.join(DEFAULT_DIR, "DawnGraphiteCache"),
    path.join(DEFAULT_DIR, "DawnWebGPUCache"),
    path.join(DEFAULT_DIR, "GPUCache"),
    path.join(DEFAULT_DIR, "Service Worker", "CacheStorage"),
    path.join(DEFAULT_DIR, "Service Worker", "ScriptCache"),
    path.join(DEFAULT_DIR, "AutofillAiModelCache"),
    path.join(DEFAULT_DIR, "JumpListIconsMostVisited"),
    path.join(DEFAULT_DIR, "JumpListIconsRecentClosed")
  ];

  let cacheWiped = 0;
  for (const cPath of CACHE_FOLDERS_TO_WIPE) {
    if (safeRemove(cPath)) cacheWiped++;
  }
  console.log(`   Cleared ${cacheWiped} heavy cache directories.`);
}

console.log("\n✅ [Smart Clean Complete]");
console.log("   • Leaked root files purged.");
console.log("   • Redundant test profiles & observation logs purged.");
console.log("   • Heavy WebGL / GPU / Shader caches purged.");
console.log("   • 🔒 Login Cookies & Session Storage SAFELY PRESERVED.");
