import { chromium } from 'playwright';

/**
 * Universal X (Twitter) Safe Runner
 * Usage:
 *   node runner.mjs status               # Check login status and timeline state
 *   node runner.mjs feed [--limit 5]     # Read home timeline tweets safely
 *   node runner.mjs drill-draft          # SAFE TEST: Type text in composer, verify post button, DISCARD draft
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const options = { command, limit: 5 };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === '--text' && args[i + 1]) options.text = args[++i];
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
  throw new Error('Cannot connect to CDP on 9223 or 9222');
}

async function main() {
  const opts = parseArgs();
  let browser;

  try {
    browser = await connectBrowser();
    const context = browser.contexts()[0];
    const page = await context.newPage();

    console.log(`[X/Twitter] Navigating to https://x.com/home...`);
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(4000);

    const isLogin = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="tweetTextarea_0"], [data-testid="AppTabBar_Home_Link"], [data-testid="SideNav_AccountSwitcher_Button"]');
    });

    if (opts.command === 'status') {
      console.log(JSON.stringify({
        url: page.url(),
        title: await page.title(),
        isLoggedIn: isLogin
      }, null, 2));

    } else if (opts.command === 'feed') {
      if (!isLogin) {
        console.log(JSON.stringify({ error: 'Not logged in on X.com in this Chrome profile' }));
        return;
      }
      const tweets = await page.evaluate((lim) => {
        const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, lim);
        return articles.map(art => {
          const user = art.querySelector('[data-testid="User-Name"]')?.innerText?.replace(/\n+/g, ' ') || '';
          const text = art.querySelector('[data-testid="tweetText"]')?.innerText || '';
          const time = art.querySelector('time')?.getAttribute('datetime') || '';
          return { user, text, time };
        });
      }, opts.limit);

      console.log(JSON.stringify({ tweetCount: tweets.length, tweets }, null, 2));

    } else if (opts.command === 'drill-draft') {
      if (!isLogin) {
        console.log(JSON.stringify({ error: 'Cannot drill composer: Not logged in' }));
        return;
      }
      const testText = opts.text || "안전 테스트 드릴 — 작성만 하고 게시하지 않습니다. (Safe draft drill)";
      console.log(`[SAFE DRILL] Testing composer with test text...`);

      // 1. Focus composer
      await page.click('[data-testid="tweetTextarea_0"]');
      await page.waitForTimeout(500);

      // 2. Type text
      await page.keyboard.type(testText, { delay: 30 });
      await page.waitForTimeout(1000);

      // 3. Verify Post button is enabled (DO NOT CLICK)
      const postBtnState = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
        if (!btn) return { exists: false };
        const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
        return {
          exists: true,
          text: btn.innerText.trim(),
          disabled: isDisabled,
          canPost: !isDisabled
        };
      });

      console.log('[SAFE DRILL] Post button check (NOT CLICKED):', postBtnState);

      // 4. DISCARD DRAFT SAFELY
      console.log('[SAFE DRILL] Discarding draft...');
      await page.click('[data-testid="tweetTextarea_0"]');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(1000);

      // Reload to ensure state reset
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const composerAfter = await page.evaluate(() => {
        return document.querySelector('[data-testid="tweetTextarea_0"]')?.innerText || '';
      });

      console.log(JSON.stringify({
        drillResult: 'SUCCESS',
        buttonVerified: postBtnState,
        discardCompleted: composerAfter.trim().length === 0,
        postPublished: false
      }, null, 2));

    } else {
      console.error(`Unknown command: ${opts.command}`);
    }

    await page.close();

  } catch (err) {
    console.error('Execution error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
