import playwright from 'playwright';

/**
 * Universal Google Trends Runner
 * 
 * Usage:
 *   node runner.mjs daily [--geo KR|US|JP] [--limit 10]
 *   node runner.mjs explore --keyword "AI" [--geo KR]
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'daily';
  const options = { command, geo: 'KR', limit: 10 };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--geo' && args[i + 1]) options.geo = args[++i].toUpperCase();
    else if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === '--keyword' && args[i + 1]) options.keyword = args[++i];
  }
  return options;
}

async function connectBrowser() {
  const ports = [9223, 9222];
  for (const port of ports) {
    try {
      const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      return browser;
    } catch {}
  }
  throw new Error('Cannot connect to Chrome on CDP 9223 or 9222');
}

async function main() {
  const opts = parseArgs();
  let browser;

  try {
    browser = await connectBrowser();
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find(p => p.url().includes('trends.google'));
    if (!page) page = await ctx.newPage();

    if (opts.command === 'daily') {
      const rssUrl = `https://trends.google.com/trending/rss?geo=${opts.geo}`;
      console.log(`[Google Trends] Fetching daily trends for geo=${opts.geo}...`);

      const xml = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return await res.text();
      }, rssUrl);

      const items = [];
      const itemMatches = xml.split('<item>');
      for (let i = 1; i < itemMatches.length; i++) {
        const chunk = itemMatches[i];
        const titleMatch = chunk.match(/<title>([^<]+)<\/title>/);
        const trafficMatch = chunk.match(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/);
        const pubDateMatch = chunk.match(/<pubDate>([^<]+)<\/pubDate>/);
        const newsTitles = Array.from(chunk.matchAll(/<ht:news_item_title>([^<]+)<\/ht:news_item_title>/g)).map(m => m[1]);

        if (titleMatch) {
          items.push({
            rank: i,
            keyword: titleMatch[1],
            traffic: trafficMatch ? trafficMatch[1] : '',
            pubDate: pubDateMatch ? pubDateMatch[1] : '',
            topNews: newsTitles.slice(0, 2)
          });
        }
      }

      console.log(JSON.stringify({
        status: 'SUCCESS',
        geo: opts.geo,
        total: items.length,
        showing: Math.min(items.length, opts.limit),
        trends: items.slice(0, opts.limit)
      }, null, 2));

    } else if (opts.command === 'explore') {
      if (!opts.keyword) {
        console.error('Error: --keyword is required for explore command');
        process.exit(1);
      }
      const exploreUrl = `https://trends.google.co.kr/trends/explore?date=now%207-d&geo=${opts.geo}&q=${encodeURIComponent(opts.keyword)}`;
      console.log(`[Google Trends] Exploring interest over time: ${exploreUrl}`);
      await page.goto(exploreUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);

      const title = await page.title();
      console.log(JSON.stringify({
        status: 'SUCCESS',
        keyword: opts.keyword,
        geo: opts.geo,
        url: exploreUrl,
        pageTitle: title
      }, null, 2));
    } else {
      console.log('Usage: node runner.mjs daily [--geo KR|US] [--limit 10]');
    }

    await page.close();

  } catch (err) {
    console.error('Execution error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
