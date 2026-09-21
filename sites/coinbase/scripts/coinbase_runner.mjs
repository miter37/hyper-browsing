import playwright from 'playwright';

/**
 * Universal Coinbase Market Explorer Runner
 * 
 * Usage:
 *   node coinbase_runner.mjs explore [--limit 15]
 *   node coinbase_runner.mjs ticker --coin ETH
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'explore';
  const options = { command, limit: 15, coin: '' };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === '--coin' && args[i + 1]) options.coin = args[++i].toUpperCase();
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
    let page = ctx.pages().find(p => p.url().includes('coinbase.com'));
    if (!page) page = await ctx.newPage();

    if (opts.command === 'explore') {
      const exploreUrl = 'https://www.coinbase.com/explore';
      console.log(`[Coinbase] Navigating to explore: ${exploreUrl}...`);

      await page.goto(exploreUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      const coins = await page.evaluate((lim) => {
        const rows = Array.from(document.querySelectorAll('table tbody tr, [role="row"]')).slice(1, lim + 1);
        return rows.map(r => {
          const lines = r.innerText.split('\n').map(s => s.trim()).filter(Boolean);
          const link = r.querySelector('a')?.href || '';
          return {
            name: lines[0] === '󰟶' ? lines[1] : lines[0],
            symbol: lines[0] === '󰟶' ? lines[2] : lines[1],
            price: lines.find(l => l.includes('₩') || l.includes('$')) || '',
            change: lines.find(l => l.endsWith('%')) || '',
            url: link
          };
        });
      }, opts.limit);

      console.log(JSON.stringify({
        status: 'SUCCESS',
        total: coins.length,
        coins
      }, null, 2));

    } else if (opts.command === 'ticker') {
      if (!opts.coin) {
        console.error('Error: --coin is required (e.g. BTC, ETH, SOL)');
        process.exit(1);
      }
      const coinUrl = `https://www.coinbase.com/price/${opts.coin.toLowerCase()}`;
      console.log(`[Coinbase] Loading coin page: ${coinUrl}...`);

      await page.goto(coinUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(() => {
        const title = document.title;
        const price = document.querySelector('[data-testid="asset-price"], [class*="Price"]')?.innerText?.trim() || '';
        return {
          title,
          price
        };
      });

      console.log(JSON.stringify({
        status: 'SUCCESS',
        coin: opts.coin,
        data
      }, null, 2));

    } else {
      console.log('Usage: node coinbase_runner.mjs explore [--limit 15]');
    }

    await page.close();

  } catch (err) {
    console.error('Execution error:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
