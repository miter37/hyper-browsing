import { chromium } from 'playwright';

/**
 * Universal Airbnb Search & Listings Runner
 * 
 * Usage:
 *   node runner.mjs search --location "서울" --checkin 2026-10-15 --checkout 2026-10-18 [--query "한옥"] [--adults 2] [--limit 10]
 *   node runner.mjs detail --url "https://www.airbnb.co.kr/rooms/12345678"
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'search';
  const options = {
    command,
    location: '서울',
    query: '',
    checkin: '',
    checkout: '',
    adults: 1,
    limit: 10
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--location' && args[i + 1]) options.location = args[++i];
    else if (args[i] === '--query' && args[i + 1]) options.query = args[++i];
    else if (args[i] === '--checkin' && args[i + 1]) options.checkin = args[++i];
    else if (args[i] === '--checkout' && args[i + 1]) options.checkout = args[++i];
    else if (args[i] === '--adults' && args[i + 1]) options.adults = parseInt(args[++i], 10);
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
    } catch {}
  }
  throw new Error('Cannot connect to Chrome on CDP 9223 or 9222');
}

async function main() {
  const opts = parseArgs();
  let browser;

  try {
    browser = await connectBrowser();
    const context = browser.contexts()[0];
    const page = await context.newPage();

    if (opts.command === 'search') {
      const searchTerms = [opts.location, opts.query].filter(Boolean).join(' ');
      const params = new URLSearchParams({
        query: searchTerms,
        tab_id: 'home_tab',
        search_mode: 'regular_search',
        adults: opts.adults.toString()
      });

      if (opts.checkin) params.set('checkin', opts.checkin);
      if (opts.checkout) params.set('checkout', opts.checkout);

      const targetUrl = `https://www.airbnb.co.kr/s/${encodeURIComponent(opts.location)}/homes?${params.toString()}`;
      console.log(`[Airbnb] Navigating to: ${targetUrl}`);

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);

      // Trigger lazy loading
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(1000);
      }

      const listings = await page.evaluate((lim) => {
        const cards = Array.from(document.querySelectorAll('[data-testid="card-container"]'));
        return cards.map(c => {
          const title = c.querySelector('[data-testid="listing-card-title"]')?.innerText?.trim() || '';
          const link = c.querySelector('a[href*="/rooms/"]')?.href || '';
          const lines = c.innerText.split('\n').map(s => s.trim()).filter(Boolean);

          let price = '';
          let rating = '';
          lines.forEach(l => {
            if (l.startsWith('총액') || l.startsWith('₩')) price = l;
            if (l.includes('평점') || /^[0-9]\.[0-9]{1,2}/.test(l)) rating = l;
          });

          return {
            title,
            rating,
            price,
            summary: lines.slice(0, 6).join(' | '),
            url: link ? link.split('?')[0] : ''
          };
        }).filter(item => item.title).slice(0, lim);
      }, opts.limit);

      console.log(JSON.stringify({
        status: 'SUCCESS',
        location: opts.location,
        query: opts.query,
        checkin: opts.checkin,
        checkout: opts.checkout,
        totalReturned: listings.length,
        listings
      }, null, 2));

      await page.close();

    } else if (opts.command === 'detail') {
      if (!opts.url) {
        console.error('Error: --url is required for detail command');
        process.exit(1);
      }

      console.log(`[Airbnb] Loading room details: ${opts.url}`);
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      const details = await page.evaluate(() => {
        const title = document.querySelector('h1')?.innerText?.trim() || document.title;
        const sub = document.querySelector('[data-section-id="OVERVIEW_DEFAULT"]')?.innerText?.trim() || '';
        return {
          title,
          overview: sub.split('\n').map(s => s.trim()).filter(Boolean)
        };
      });

      console.log(JSON.stringify(details, null, 2));
      await page.close();

    } else {
      console.log(`Usage: node runner.mjs search --location "..." [--checkin YYYY-MM-DD --checkout YYYY-MM-DD]`);
    }

  } catch (err) {
    console.error('Execution error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
