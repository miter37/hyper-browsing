import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

/**
 * Hyper-Browsing Core Extensions Suite
 * 
 * Provides:
 *   1. user-intervene : Reveal window & pause execution safely until condition met
 *   2. smart-scroll   : Continuous accumulator scroll across Virtual DOM
 *   3. sniff-ws       : Real-time WebSocket frame sniffer
 *   4. download       : Authenticated file / PDF downloader
 */

function parseArgs(args) {
  const flags = {};
  const boolFlags = new Set();
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[k] = next;
        i++;
      } else {
        boolFlags.add(k);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, boolFlags };
}

async function connectBrowser() {
  const ports = [9223, 9222];
  for (const port of ports) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {}
  }
  throw new Error("Cannot connect to Chrome on CDP 9223 or 9222");
}

async function getTargetPage(browser, sessionId, urlMatch) {
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  if (urlMatch) {
    const found = pages.find(p => p.url().includes(urlMatch));
    if (found) return found;
  }
  return pages[0] || await ctx.newPage();
}

// -----------------------------------------------------------------------------
// 1. user-intervene: Human In The Loop Helper
// -----------------------------------------------------------------------------
async function runUserIntervene(flags) {
  const reason = flags.reason || "로그인 또는 캡차를 통과해 주세요.";
  const untilUrl = flags["until-url"] || "";
  const untilText = flags["until-text"] || "";
  const timeoutSec = parseInt(flags.timeout || "120", 10);

  const browser = await connectBrowser();
  const page = await getTargetPage(browser, flags.session, untilUrl);

  // Bring window to front
  await page.bringToFront();

  console.log(JSON.stringify({
    status: "INTERVENTION_REQUESTED",
    message: `[인간 개입 요청] ${reason}`,
    guidance: "화면에 열린 Chrome 브라우저에서 작업을 완료해 주세요.",
    waitingConditions: { untilUrl, untilText, timeoutSec }
  }, null, 2));

  const startTime = Date.now();
  while ((Date.now() - startTime) / 1000 < timeoutSec) {
    await new Promise(r => setTimeout(r, 2000));
    const curUrl = page.url();
    const title = await page.title();

    if (untilUrl && curUrl.includes(untilUrl)) {
      console.log(JSON.stringify({
        status: "RESOLVED",
        resolvedBy: "url_match",
        currentUrl: curUrl,
        pageTitle: title
      }, null, 2));
      return;
    }

    if (untilText) {
      const hasText = await page.evaluate((t) => document.body.innerText.includes(t), untilText);
      if (hasText) {
        console.log(JSON.stringify({
          status: "RESOLVED",
          resolvedBy: "text_match",
          matchedText: untilText,
          currentUrl: curUrl
        }, null, 2));
        return;
      }
    }
  }

  console.log(JSON.stringify({
    status: "TIMEOUT",
    message: "지정된 대기 시간이 초과되었습니다.",
    currentUrl: page.url()
  }, null, 2));
}

// -----------------------------------------------------------------------------
// 2. smart-scroll: Virtual DOM Accumulator
// -----------------------------------------------------------------------------
async function runSmartScroll(flags) {
  const selector = flags.selector || "[data-testid], article, div[role='row'], div";
  const targetCount = parseInt(flags["target-count"] || "20", 10);
  const distance = parseInt(flags.distance || "800", 10);
  const maxRounds = parseInt(flags["max-rounds"] || "15", 10);

  const browser = await connectBrowser();
  const page = await getTargetPage(browser, flags.session);

  const collected = new Map();
  console.log(`[smart-scroll] Accumulating items matching: ${selector} (target: ${targetCount})...`);

  for (let round = 0; round < maxRounds; round++) {
    const items = await page.evaluate((sel) => {
      const els = Array.from(document.querySelectorAll(sel));
      return els.map(el => {
        const text = (el.innerText || "").trim();
        const link = el.querySelector("a")?.href || el.getAttribute("href") || "";
        const id = el.id || el.getAttribute("data-id") || el.getAttribute("data-urn") || link || text.slice(0, 40);
        return { id, text, link };
      }).filter(x => x.text.length > 20);
    }, selector);

    items.forEach(it => {
      if (it.id && !collected.has(it.id)) {
        collected.set(it.id, it);
      }
    });

    if (collected.size >= targetCount) break;

    // Scroll and wait
    await page.evaluate((d) => window.scrollBy(0, d), distance);
    await page.waitForTimeout(1200);
  }

  const results = Array.from(collected.values()).slice(0, targetCount);
  console.log(JSON.stringify({
    status: "SUCCESS",
    totalAccumulated: collected.size,
    returned: results.length,
    items: results.map(r => ({
      id: r.id,
      preview: r.text.split("\n").filter(Boolean).slice(0, 3).join(" | "),
      link: r.link
    }))
  }, null, 2));
}

// -----------------------------------------------------------------------------
// 3. sniff-ws: WebSocket Frame Interceptor
// -----------------------------------------------------------------------------
async function runSniffWs(flags) {
  const durationSec = parseInt(flags.duration || "5", 10);
  const filter = flags.filter ? new RegExp(flags.filter, "i") : null;
  const limit = parseInt(flags.limit || "10", 10);

  const browser = await connectBrowser();
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || await ctx.newPage();

  const frames = [];
  const cdpSession = await ctx.newCDPSession(page);
  await cdpSession.send("Network.enable");

  cdpSession.on("Network.webSocketFrameReceived", (evt) => {
    const payload = evt.response.payloadData;
    if (payload && (!filter || filter.test(payload))) {
      frames.push({
        type: "received",
        time: evt.timestamp,
        data: payload.slice(0, 300)
      });
    }
  });

  cdpSession.on("Network.webSocketFrameSent", (evt) => {
    const payload = evt.response.payloadData;
    if (payload && (!filter || filter.test(payload))) {
      frames.push({
        type: "sent",
        time: evt.timestamp,
        data: payload.slice(0, 300)
      });
    }
  });

  console.log(`[sniff-ws] Sniffing WebSocket frames for ${durationSec}s...`);
  await new Promise(r => setTimeout(r, durationSec * 1000));
  await cdpSession.detach();

  console.log(JSON.stringify({
    status: "SUCCESS",
    totalCaptured: frames.length,
    captured: frames.slice(0, limit)
  }, null, 2));
}

// -----------------------------------------------------------------------------
// 4. download: Authenticated File / PDF Downloader
// -----------------------------------------------------------------------------
async function runDownload(flags) {
  const url = flags.url;
  const outPath = flags.out || path.join(process.cwd(), path.basename(url.split("?")[0]) || "downloaded.file");

  if (!url) {
    console.error("Missing --url");
    process.exit(1);
  }

  const browser = await connectBrowser();
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || await ctx.newPage();

  console.log(`[download] Downloading ${url} with session cookies...`);
  const response = await page.request.get(url);
  const buffer = await response.body();

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), buffer);

  console.log(JSON.stringify({
    status: "SUCCESS",
    url,
    savedTo: path.resolve(outPath),
    sizeBytes: buffer.length
  }, null, 2));
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0];

  try {
    if (cmd === "user-intervene") await runUserIntervene(flags);
    else if (cmd === "smart-scroll") await runSmartScroll(flags);
    else if (cmd === "sniff-ws") await runSniffWs(flags);
    else if (cmd === "download") await runDownload(flags);
    else {
      console.log(`
Hyper-Browsing Core Tools Extension:
  node tools.mjs user-intervene --reason "..." [--until-url "..."] [--until-text "..."]
  node tools.mjs smart-scroll [--selector "..."] [--target-count 20]
  node tools.mjs sniff-ws [--duration 5] [--filter "trade|order"]
  node tools.mjs download --url "https://..." --out "./path/file.pdf"
`);
    }
  } catch (err) {
    console.error(JSON.stringify({ status: "ERROR", message: err.message }, null, 2));
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
