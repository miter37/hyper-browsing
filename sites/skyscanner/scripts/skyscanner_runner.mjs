import { chromium } from 'playwright';

/**
 * Universal Skyscanner Flight Search Runner
 * 
 * Handles URL formation, flight search query generation, and PerimeterX bot challenge detection.
 * 
 * Usage:
 *   node runner.mjs build-url --origin SELA --dest TYOA --depart 261015 --return 261018
 *   node runner.mjs search --origin SELA --dest TYOA --depart 261015 --return 261018 [--adults 1]
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options = { command, adults: 1, cabin: 'economy' };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--origin' && args[i + 1]) options.origin = args[++i].toLowerCase();
    else if (args[i] === '--dest' && args[i + 1]) options.dest = args[++i].toLowerCase();
    else if (args[i] === '--depart' && args[i + 1]) options.depart = args[++i]; // YYMMDD or YYYY-MM-DD
    else if (args[i] === '--return' && args[i + 1]) options.returnDate = args[++i];
    else if (args[i] === '--adults' && args[i + 1]) options.adults = parseInt(args[++i], 10);
    else if (args[i] === '--cabin' && args[i + 1]) options.cabin = args[++i];
  }
  return options;
}

function formatSkyscannerDate(dStr) {
  if (!dStr) return '';
  // Convert 2026-10-15 or 20261015 -> 261015
  const clean = dStr.replace(/-/g, '');
  if (clean.length === 8) {
    return clean.slice(2);
  }
  return clean;
}

function buildFlightUrl(opts) {
  const origin = opts.origin || 'sela'; // Seoul All Airports (ICN, GMP)
  const dest = opts.dest || 'tyoa';     // Tokyo All Airports (HND, NRT)
  const dep = formatSkyscannerDate(opts.depart || '261015');
  const ret = opts.returnDate ? `/${formatSkyscannerDate(opts.returnDate)}` : '';
  const adults = opts.adults || 1;
  const cabin = opts.cabin || 'economy';

  return `https://www.skyscanner.co.kr/transport/flights/${origin}/${dest}/${dep}${ret}/?adultsv2=${adults}&cabinclass=${cabin}&childrenv2=&ref=home`;
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

  if (opts.command === 'build-url') {
    const url = buildFlightUrl(opts);
    console.log(JSON.stringify({
      status: 'ok',
      query: { origin: opts.origin, dest: opts.dest, depart: opts.depart, return: opts.returnDate },
      url
    }, null, 2));
    return;
  }

  if (opts.command === 'search') {
    const targetUrl = buildFlightUrl(opts);
    console.log(`[Skyscanner] Navigating to: ${targetUrl}`);

    let browser;
    try {
      browser = await connectBrowser();
      const context = browser.contexts()[0];
      const page = await context.newPage();

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      });

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(5000);

      const currentUrl = page.url();
      const title = await page.title();
      const isBlocked = currentUrl.includes('/sttc/px/captcha-v2/') || title.includes('귀하는 사람인가요');

      if (isBlocked) {
        console.log(JSON.stringify({
          status: 'CHALLENGE_REQUIRED',
          securityProvider: 'PerimeterX (HUMAN Security)',
          currentUrl,
          message: 'PerimeterX 봇 보호 챌린지가 활성화되었습니다. 웹 브라우저 창에서 직접 캡차(버튼 길게 누르기)를 1회 통과하면 세션 쿠키가 유지됩니다.',
          manualUnlockUrl: currentUrl
        }, null, 2));
      } else {
        // Parse flight results
        const itineraries = await page.evaluate(() => {
          const cards = document.querySelectorAll('[data-testid="itinerary-card"], [role="listitem"]');
          const data = [];
          cards.forEach(c => {
            const lines = c.innerText.split('\n').map(s => s.trim()).filter(Boolean);
            if (lines.length >= 3) {
              data.push(lines.slice(0, 6).join(' | '));
            }
          });
          return data;
        });

        console.log(JSON.stringify({
          status: 'SUCCESS',
          totalFound: itineraries.length,
          flights: itineraries.slice(0, 10)
        }, null, 2));
      }

      await page.close();

    } catch (err) {
      console.error('Execution error:', err.message);
    } finally {
      process.exit(0);
    }
  } else {
    console.log(`
Universal Skyscanner Runner Usage:
  node runner.mjs build-url --origin SELA --dest TYOA --depart 2026-10-15 --return 2026-10-18
  node runner.mjs search --origin SELA --dest TYOA --depart 2026-10-15 --return 2026-10-18
`);
  }
}

main();
