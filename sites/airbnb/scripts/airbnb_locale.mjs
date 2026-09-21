import { chromium } from 'playwright';

/**
 * Airbnb Locale & Currency Manager (airbnb_locale.mjs)
 * 
 * Standalone runner to inspect and switch language / currency settings on Airbnb
 * using the real Chrome browser profile.
 * 
 * Usage:
 *   node airbnb_locale.mjs status [--domain airbnb.com]
 *   node airbnb_locale.mjs set --lang "English (United States)" [--currency KRW] [--domain airbnb.com]
 *   node airbnb_locale.mjs set --lang "한국어" [--currency KRW]
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const options = {
    command,
    domain: 'airbnb.com',
    lang: 'English (United States)',
    currency: 'KRW'
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--domain' && next) options.domain = args[++i];
    else if ((arg === '--lang' || arg === '--language') && next) options.lang = args[++i];
    else if (arg === '--currency' && next) options.currency = args[++i];
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
  throw new Error('Cannot connect to Chrome on CDP port 9223 or 9222');
}

async function main() {
  const opts = parseArgs();
  let browser;
  let page;

  try {
    browser = await connectBrowser();
    const context = browser.contexts()[0];
    page = await context.newPage();

    const cleanDomain = opts.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const baseUrl = `https://${cleanDomain}/`;

    if (opts.command === 'status') {
      console.log(`[Airbnb Locale] Navigating to: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2000);

      const status = await page.evaluate(() => {
        const lang = document.documentElement.lang || '';
        const langBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.getAttribute('aria-label')?.includes('language') ||
          b.getAttribute('aria-label')?.includes('언어') ||
          b.innerText?.includes('language')
        );
        const currencyBtn = document.querySelector('[data-testid="footer-currency-btn"]') ||
          Array.from(document.querySelectorAll('button')).find(b =>
            b.getAttribute('aria-label')?.includes('currency') ||
            b.getAttribute('aria-label')?.includes('통화')
          );

        return {
          currentUrl: location.href,
          htmlLang: lang,
          languageButtonText: langBtn?.innerText?.trim() || null,
          currencyButtonText: currencyBtn?.innerText?.trim() || null
        };
      });

      console.log(JSON.stringify({ status: 'OK', domain: cleanDomain, ...status }, null, 2));

    } else if (opts.command === 'set') {
      console.log(`[Airbnb Locale] Opening ${baseUrl} to switch language to: "${opts.lang}"`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2500);

      // Preemptively dismiss cookie banner
      try {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            /accept|agree|동의|확인|close|닫기/i.test(b.innerText || '')
          );
          if (btn && btn.offsetHeight > 0) btn.click();
        });
      } catch {}

      // Open Language & Currency modal
      const modalOpened = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b =>
          b.getAttribute('aria-label')?.toLowerCase().includes('language') ||
          b.getAttribute('aria-label')?.includes('언어') ||
          b.innerText?.includes('Choose a language') ||
          b.innerText?.includes('언어 및 통화')
        );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!modalOpened) {
        throw new Error('Could not find language/currency trigger button on page header.');
      }

      // Wait for modal dialog
      await page.waitForSelector('[role="dialog"]', { timeout: 6000 });
      await page.waitForTimeout(1000);

      // Normalize search term
      let targetTerm = opts.lang;
      if (targetTerm.toLowerCase() === 'en' || targetTerm.toLowerCase() === 'en-us') {
        targetTerm = 'English (United States)';
      } else if (targetTerm.toLowerCase() === 'ko') {
        targetTerm = '한국어';
      }

      // Click matching language in dialog
      const clicked = await page.evaluate(({ term }) => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { success: false, reason: 'dialog not found' };

        const items = Array.from(dialog.querySelectorAll('a, button'));
        let match = items.find(el => {
          const t = el.innerText || '';
          if (term === 'English (United States)') {
            return t.includes('English') && t.includes('United States');
          }
          return t.includes(term);
        });

        if (match) {
          match.click();
          return { success: true, matchedText: match.innerText.trim() };
        }
        return { success: false, availableCount: items.length };
      }, { term: targetTerm });

      if (!clicked.success) {
        throw new Error(`Failed to locate language option matching "${targetTerm}" inside dialog.`);
      }

      console.log(`[Airbnb Locale] Clicked language option: ${clicked.matchedText}`);
      await page.waitForTimeout(3000);

      const finalState = await page.evaluate(() => ({
        url: location.href,
        lang: document.documentElement.lang
      }));

      console.log(JSON.stringify({
        status: 'SUCCESS',
        requestedLanguage: targetTerm,
        appliedLanguage: finalState.lang,
        url: finalState.url
      }, null, 2));
    }
  } catch (err) {
    console.error(JSON.stringify({ status: 'ERROR', error: err.message }, null, 2));
    process.exit(1);
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
    process.exit(0);
  }
}

main();
