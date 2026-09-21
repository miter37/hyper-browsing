import { chromium } from 'playwright';

/**
 * Universal Ticketmaster Singapore Runner
 * Usage:
 *   node runner.mjs list [--month "Oct 2026"] [--keyword "K-POP"] [--limit 20]
 *   node runner.mjs detail --url "<event_detail_url>"
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';
  const options = { command, limit: 20 };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--month' && args[i + 1]) options.month = args[++i];
    else if (args[i] === '--keyword' && args[i + 1]) options.keyword = args[++i];
    else if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === '--url' && args[i + 1]) options.url = args[++i];
  }
  return options;
}

async function connectBrowser() {
  const ports = [9223, 9222];
  for (const port of ports) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      return browser;
    } catch {
      // try next
    }
  }
  throw new Error('Could not connect to Chrome on CDP ports 9223 or 9222');
}

async function main() {
  const opts = parseArgs();
  let browser;

  try {
    browser = await connectBrowser();
    const context = browser.contexts()[0];
    const page = await context.newPage();

    if (opts.command === 'list') {
      const targetUrl = 'https://ticketmaster.sg/activity';
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Scroll to trigger lazy loading if needed
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(800);
      }

      const events = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/activity/detail/"]');
        const list = [];
        const seen = new Set();

        links.forEach(a => {
          const href = a.href;
          if (seen.has(href)) return;
          seen.add(href);

          const fullText = a.innerText.trim() || a.closest('.card, .activity-item, tr')?.innerText?.trim() || '';
          const lines = fullText.split('\n').map(s => s.trim()).filter(Boolean);

          let date = '';
          let title = '';
          if (lines.length >= 2) {
            date = lines[0];
            title = lines.slice(1).join(' - ');
          } else if (lines.length === 1) {
            title = lines[0];
          }

          list.push({
            title,
            date,
            url: href,
            raw: fullText.replace(/\n+/g, ' | ')
          });
        });

        return list;
      });

      let filtered = events;
      if (opts.month) {
        filtered = filtered.filter(e => e.date.toLowerCase().includes(opts.month.toLowerCase()) || e.raw.toLowerCase().includes(opts.month.toLowerCase()));
      }
      if (opts.keyword) {
        filtered = filtered.filter(e => e.title.toLowerCase().includes(opts.keyword.toLowerCase()) || e.raw.toLowerCase().includes(opts.keyword.toLowerCase()));
      }

      const results = filtered.slice(0, opts.limit);
      console.log(JSON.stringify({
        totalMatched: filtered.length,
        showing: results.length,
        events: results
      }, null, 2));

      await page.close();

    } else if (opts.command === 'detail') {
      if (!opts.url) {
        console.error('Error: --url is required for detail command');
        process.exit(1);
      }
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      const details = await page.evaluate(() => {
        const title = document.querySelector('h1, .activity-title, .title')?.innerText?.trim() || document.title;
        const info = document.querySelector('.activity-info, .event-info, .detail-box')?.innerText?.trim() || '';
        const pricing = document.querySelector('.price, .ticket-pricing, .pricing')?.innerText?.trim() || '';
        return {
          title,
          info: info.split('\n').map(s => s.trim()).filter(Boolean),
          pricing: pricing.split('\n').map(s => s.trim()).filter(Boolean)
        };
      });

      console.log(JSON.stringify(details, null, 2));
      await page.close();
    } else {
      console.error(`Unknown command: ${opts.command}`);
      process.exit(1);
    }

  } catch (err) {
    console.error('Execution failed:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
