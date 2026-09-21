import { chromium } from 'playwright';

/**
 * Universal Threads Safe Runner
 * Usage:
 *   node runner.mjs status               # Check login status and timeline state
 *   node runner.mjs feed [--limit 5]     # Read feed posts safely
 *   node runner.mjs drill-draft          # SAFE TEST: Open composer, type text, verify Post button, DISCARD draft
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

    console.log(`[Threads] Navigating to https://www.threads.com/...`);
    await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(4000);

    const isLogin = await page.evaluate(() => {
      return !!document.querySelector('a[href^="https://www.threads.com/@"], a[href^="/@"], [aria-label="새로운 스레드"], [aria-label="Create"]');
    });

    if (opts.command === 'status') {
      console.log(JSON.stringify({
        url: page.url(),
        title: await page.title(),
        isLoggedIn: isLogin
      }, null, 2));

    } else if (opts.command === 'feed') {
      const posts = await page.evaluate((lim) => {
        const containers = Array.from(document.querySelectorAll('[data-pressable-container="true"]')).slice(0, lim);
        return containers.map(c => c.innerText.split('\n').filter(Boolean).slice(0, 4).join(' | '));
      }, opts.limit);

      console.log(JSON.stringify({ postCount: posts.length, posts }, null, 2));

    } else if (opts.command === 'drill-draft') {
      if (!isLogin) {
        console.log(JSON.stringify({ error: 'Cannot drill composer: Not logged in on Threads' }));
        return;
      }
      const testText = opts.text || "스레드 안전 테스트 드릴 — 게시하지 않습니다.";
      console.log('[SAFE DRILL] Opening Threads composer...');

      // Find compose button
      const opened = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('span, svg, div[role="button"]'))
          .find(el => /새로운 스레드|New thread|Create/i.test(el.getAttribute('aria-label') || el.innerText || ''));
        if (btn) {
          (btn.closest('div[role="button"]') || btn).click();
          return true;
        }
        return false;
      });

      if (!opened) {
        console.log(JSON.stringify({ error: 'Could not find compose trigger' }));
        return;
      }

      await page.waitForTimeout(2000);

      // Focus textbox and type
      await page.click('div[role="textbox"][contenteditable="true"]');
      await page.keyboard.type(testText, { delay: 30 });
      await page.waitForTimeout(1000);

      // Check Post button (DO NOT CLICK)
      const postBtnState = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('div[role="button"], button'))
          .find(e => /^(게시|Post)$/.test(e.innerText.trim()));
        if (!btn) return { exists: false };
        const isDisabled = btn.getAttribute('aria-disabled') === 'true' || btn.disabled;
        return {
          exists: true,
          text: btn.innerText.trim(),
          disabled: isDisabled,
          canPost: !isDisabled
        };
      });

      console.log('[SAFE DRILL] Post button check (NOT CLICKED):', postBtnState);

      // SAFELY DISCARD
      console.log('[SAFE DRILL] Discarding draft without posting...');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);

      // Close modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);

      const isDialogGone = await page.evaluate(() => {
        return !document.querySelector('div[role="textbox"][contenteditable="true"]');
      });

      console.log(JSON.stringify({
        drillResult: 'SUCCESS',
        buttonVerified: postBtnState,
        dialogClosed: isDialogGone,
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
