#!/usr/bin/env node
/**
 * Naver Real Estate (new.land.naver.com) Unified CLI Runner
 *
 * Subcommands:
 *   1) search   : Find complex ID & basic info by name/keyword
 *      node land.mjs search --keyword "마포래미안푸르지오"
 *
 *   2) areas    : List available area/pyeong types for a complex
 *      node land.mjs areas --complex 104917 (or --name "단지명")
 *
 *   3) listings : Query and scrape listings with dynamic filters (trade, pyeong, sorting)
 *      node land.mjs listings --name "마포래미안푸르지오" --trade "매매" --pyeong 30 --limit 15
 */

import playwright from "playwright";

function parseArgs(args) {
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "listings";
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      flags[key] = val;
    }
  }
  return { command, flags };
}

async function getBrowserSession(port = "9223") {
  const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages().find((p) => p.url().includes("new.land.naver.com"));
  if (!page) page = await ctx.newPage();
  return { browser, page };
}

// 1. 단지 검색 (search)
async function findComplex(page, keyword) {
  if (!page.url().includes("new.land.naver.com")) {
    await page.goto("https://new.land.naver.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
  }

  const result = await page.evaluate(async (kw) => {
    try {
      const res = await fetch(`https://new.land.naver.com/api/search?keyword=${encodeURIComponent(kw)}`);
      return await res.json();
    } catch {
      return null;
    }
  }, keyword);

  if (!result?.complexes?.length) {
    return [];
  }

  return result.complexes.map((c) => ({
    complexNo: c.complexNo,
    complexName: c.complexName,
    cortarAddress: c.cortarAddress,
    realEstateTypeName: c.realEstateTypeName,
    totalHouseholdCount: c.totalHouseholdCount,
    useApproveYmd: c.useApproveYmd,
  }));
}

// 2. 단지 면적/평형 조회 (areas)
async function inspectAreas(page, complexId) {
  await page.goto(`https://new.land.naver.com/complexes/${complexId}`, {
    waitUntil: "domcontentloaded",
    timeout: 25000,
  });
  await page.waitForTimeout(1500);

  const filterBtns = await page.$$("button.list_filter_btn");
  if (filterBtns.length > 1) {
    await filterBtns[1].click();
    await page.waitForTimeout(400);

    const areas = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll(".area_layer label, .filter_popup label, .layer_area label, label")
      );
      return els
        .map((e) => e.innerText.trim())
        .filter((t) => t.includes("m²") || t.includes("㎡") || t.match(/[0-9]+/));
    });

    await filterBtns[1].click();
    return areas;
  }
  return [];
}

// 3. 매물 조회 (listings)
async function queryListings(page, { name, complexId, trade = "매매", pyeong = 30, limit = 20 }) {
  let targetId = complexId;
  let targetName = name;

  if (!targetId) {
    const found = await findComplex(page, name || "마포래미안푸르지오");
    if (!found.length) {
      throw new Error(`단지를 찾을 수 없습니다: ${name}`);
    }
    targetId = found[0].complexNo;
    targetName = found[0].complexName;
  }

  await page.goto(`https://new.land.naver.com/complexes/${targetId}`, {
    waitUntil: "domcontentloaded",
    timeout: 25000,
  });
  await page.waitForTimeout(1500);

  // 거래방식 필터 적용 (매매/전세/월세)
  const tradeBtn = (await page.$$("button.list_filter_btn"))[0];
  if (tradeBtn) {
    const curText = await tradeBtn.innerText();
    if (!curText.includes(trade)) {
      await tradeBtn.click();
      await page.waitForTimeout(300);
      await page.evaluate((t) => {
        const labels = Array.from(document.querySelectorAll(".filter_popup label, .area_layer label, label"));
        const match = labels.find((l) => l.innerText.trim() === t);
        if (match) match.click();
      }, trade);
      await tradeBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // 평형 필터 적용
  const targetPyeongNum = parseInt(pyeong, 10);
  if (targetPyeongNum) {
    const areaBtn = (await page.$$("button.list_filter_btn"))[1];
    if (areaBtn) {
      await areaBtn.click();
      await page.waitForTimeout(400);

      await page.evaluate((py) => {
        const labels = Array.from(document.querySelectorAll(".filter_popup label, .area_layer label, label"));
        for (const l of labels) {
          const txt = l.innerText.trim();
          const m = txt.match(/([0-9]+)/);
          if (!m) continue;
          const supplyM2 = parseInt(m[1], 10);
          let match = false;
          if (py === 20 && supplyM2 >= 65 && supplyM2 <= 90) match = true;
          if (py === 30 && supplyM2 >= 100 && supplyM2 <= 125) match = true;
          if (py === 40 && supplyM2 >= 130 && supplyM2 <= 165) match = true;
          if (py >= 50 && supplyM2 >= 165) match = true;

          if (match) {
            const forId = l.getAttribute("for");
            const input = forId ? document.getElementById(forId) : null;
            if (input && !input.checked) l.click();
            else if (!input) l.click();
          }
        }
      }, targetPyeongNum);

      await areaBtn.click();
      await page.waitForTimeout(400);
    }
  }

  // 동일매물 묶기
  await page.evaluate(() => {
    const input = document.querySelector("#address_group2, input[data-nclk=\"TAA.dongil\"]");
    const label = document.querySelector("label[for=\"address_group2\"]");
    if (input && !input.checked && label) {
      label.click();
    }
  });
  await page.waitForTimeout(500);

  // 스크롤 로딩
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const el = document.querySelector(".item_list--article, .item_list");
      if (el) el.scrollTop += 3000;
    });
    await page.waitForTimeout(200);
  }

  const listings = await page.evaluate((tradeType) => {
    const cards = Array.from(document.querySelectorAll(".item"));
    const seen = new Set();
    const list = [];

    for (const c of cards) {
      const text = c.innerText.trim();
      if (!text.includes(tradeType) || seen.has(text)) continue;
      seen.add(text);

      const dongMatch = text.match(/([0-9]+동)/);
      const dong = dongMatch ? dongMatch[0] : "";
      const priceRegex = new RegExp(`${tradeType}\\s*([0-9억\\s,~]+)`);
      const priceMatch = text.match(priceRegex);
      const price = priceMatch ? priceMatch[1].trim() : "";
      const areaMatch = text.match(/([0-9]+[A-Z]?)\/([0-9]+m²)/) || text.match(/([0-9]+[A-Z]?m²)/);
      const area = areaMatch ? areaMatch[0] : "";
      const floorMatch = text.match(/([0-9]+|고|중|저)\/([0-9]+층)/);
      const floor = floorMatch ? floorMatch[0] : "";
      const dirMatch = text.match(/(남동향|남서향|남향|동향|서향|북향)/);
      const direction = dirMatch ? dirMatch[0] : "";
      const rm = text.match(/중개사\s*([0-9]+곳)/);
      const realtorCount = rm ? rm[1] : "1곳";

      if (price) {
        list.push({ dong, price, area, floor, direction, realtorCount, rawSummary: text.slice(0, 100) });
      }
    }
    return list;
  }, trade);

  const parsePrice = (p) => {
    let sum = 0;
    const uk = p.match(/([0-9]+)억/);
    if (uk) sum += parseInt(uk[1], 10) * 10000;
    const man = p.match(/억\s*([0-9,]+)/) || p.match(/^([0-9,]+)$/);
    if (man && man[1]) sum += parseInt(man[1].replace(/,/g, ""), 10);
    return sum;
  };

  listings.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));

  return {
    complexId: targetId,
    complexName: targetName,
    trade,
    pyeong: targetPyeongNum ? `${targetPyeongNum}평대` : "전체",
    totalCount: listings.length,
    listings: listings.slice(0, parseInt(limit, 10) || 20),
  };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  let browserObj = null;

  try {
    browserObj = await getBrowserSession(flags.port || "9223");
    const { page } = browserObj;

    let output;
    if (command === "search") {
      const keyword = flags.keyword || flags.name;
      if (!keyword) throw new Error("--keyword 인자가 필요합니다 (예: --keyword 마포래미안푸르지오)");
      output = await findComplex(page, keyword);
    } else if (command === "areas") {
      let complexId = flags.complex || flags.id;
      if (!complexId && flags.name) {
        const found = await findComplex(page, flags.name);
        if (found.length) complexId = found[0].complexNo;
      }
      if (!complexId) throw new Error("--complex [단지ID] 또는 --name [단지명] 인자가 필요합니다");
      output = await inspectAreas(page, complexId);
    } else if (command === "listings") {
      output = await queryListings(page, {
        name: flags.name,
        complexId: flags.complex,
        trade: flags.trade || "매매",
        pyeong: flags.pyeong || "30",
        limit: flags.limit || "15",
      });
    } else {
      throw new Error(`알 수 없는 명령어: ${command}. (가능한 서브커맨드: search, areas, listings)`);
    }

    console.log(JSON.stringify({ success: true, command, data: output }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message || String(err) }, null, 2));
    process.exit(1);
  } finally {
    if (browserObj?.browser) {
      await browserObj.browser.close().catch(() => {});
    }
    process.exit(0);
  }
}

main();
