import playwright from 'playwright';

/**
 * Universal KREAM Product & Market Price Runner
 * 
 * Usage:
 *   node kream_runner.mjs search --keyword "나이키 덩크" [--limit 10]
 *   node kream_runner.mjs search --keyword "스투시 반팔" [--limit 10]
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'search';
  const options = { command, keyword: '나이키 덩크', limit: 10 };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--keyword' && args[i + 1]) options.keyword = args[++i];
    else if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
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
    let page = ctx.pages().find(p => p.url().includes('kream.co.kr'));
    if (!page) page = await ctx.newPage();

    if (opts.command === 'search') {
      const searchUrl = `https://kream.co.kr/search?keyword=${encodeURIComponent(opts.keyword)}&tab=products`;
      console.log(`[KREAM] Searching products for: ${opts.keyword}...`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Dismiss cookie/notice modals if any
      await page.evaluate(() => {
        const closeBtn = document.querySelector('[aria-label="닫기"], button:has-text("확인")');
        if (closeBtn) closeBtn.click();
      });

      const products = await page.evaluate((lim) => {
        const cards = Array.from(document.querySelectorAll('.product_card, [class*="product_item"], [class*="item_inner"]'));
        const results = [];

        cards.forEach(c => {
          const lines = c.innerText.split('\n').map(s => s.trim()).filter(Boolean);
          const link = c.querySelector('a')?.href || '';
          if (lines.length >= 3) {
            results.push({
              brand: lines[0] || '',
              name: lines[1] || '',
              price: lines.find(l => l.endsWith('원')) || lines[3] || '',
              meta: lines.slice(2).join(' | '),
              url: link ? (link.startsWith('http') ? link : 'https://kream.co.kr' + link) : ''
            });
          }
        });
        return results.slice(0, lim);
      }, opts.limit);

      console.log(JSON.stringify({
        status: 'SUCCESS',
        keyword: opts.keyword,
        total: products.length,
        products
      }, null, 2));

    } else {
      console.log('Usage: node kream_runner.mjs search --keyword "..." [--limit 10]');
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
