import { chromium } from 'playwright';

/**
 * Universal Airbnb Search & Listings Runner
 * 
 * Usage:
 *   node airbnb_runner.mjs search --location "서울 종로구" --checkin 2026-10-20 --checkout 2026-10-24 --beds 2 --price-per-night 300000 [--limit 10]
 *   node airbnb_runner.mjs search --location "서울" --query "종로" --checkin 2026-10-20 --checkout 2026-10-24 --beds 2 --price-min 1000000 --price-max 1400000
 *   node airbnb_runner.mjs detail --url "https://www.airbnb.co.kr/rooms/1038100756772700307"
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
    adults: 2,
    beds: 1,
    priceMin: null,
    priceMax: null,
    pricePerNight: null,
    limit: 10,
    url: '',
    domain: 'airbnb.com',
    locale: 'en',
    currency: 'KRW'
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--location' && next) options.location = args[++i];
    else if (arg === '--query' && next) options.query = args[++i];
    else if (arg === '--checkin' && next) options.checkin = args[++i];
    else if (arg === '--checkout' && next) options.checkout = args[++i];
    else if ((arg === '--beds' || arg === '--min-beds') && next) options.beds = parseInt(args[++i], 10);
    else if (arg === '--adults' && next) options.adults = parseInt(args[++i], 10);
    else if (arg === '--price-min' && next) options.priceMin = parseInt(args[++i], 10);
    else if (arg === '--price-max' && next) options.priceMax = parseInt(args[++i], 10);
    else if (arg === '--price-per-night' && next) options.pricePerNight = parseInt(args[++i], 10);
    else if (arg === '--limit' && next) options.limit = parseInt(args[++i], 10);
    else if (arg === '--url' && next) options.url = args[++i];
    else if (arg === '--domain' && next) options.domain = args[++i];
    else if (arg === '--locale' && next) options.locale = args[++i];
    else if (arg === '--currency' && next) options.currency = args[++i];
  }
  return options;
}

function calculateNights(checkin, checkout) {
  if (!checkin || !checkout) return 1;
  const d1 = new Date(checkin);
  const d2 = new Date(checkout);
  const diffTime = Math.abs(d2 - d1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
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
      if (opts.beds) params.set('min_beds', opts.beds.toString());

      // Price filter handling
      const nights = calculateNights(opts.checkin, opts.checkout);
      let pMin = opts.priceMin;
      let pMax = opts.priceMax;

      if (opts.pricePerNight) {
        // e.g. 300,000 KRW per night -> ±20% budget range
        const totalTarget = opts.pricePerNight * nights;
        if (!pMin) pMin = Math.round(totalTarget * 0.8);
        if (!pMax) pMax = Math.round(totalTarget * 1.2);
      }

      if (pMin !== null || pMax !== null) {
        params.set('price_filter_input_type', '2');
        params.set('price_filter_num_nights', nights.toString());
        if (pMin !== null) params.set('price_min', pMin.toString());
        if (pMax !== null) params.set('price_max', pMax.toString());
      }

      if (opts.locale) params.set('locale', opts.locale);
      if (opts.currency) params.set('currency', opts.currency);

      let locationSlug = opts.location.replace(/\s+/g, '-');
      if (opts.location.includes('종로') || opts.location.toLowerCase().includes('jongno')) {
        locationSlug = 'Jongno-gu--Seoul--South-Korea';
      } else if (opts.location.includes('서울') || opts.location.toLowerCase().includes('seoul')) {
        locationSlug = 'Seoul--South-Korea';
      }

      const domain = opts.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const targetUrl = `https://${domain}/s/${encodeURIComponent(locationSlug)}/homes?${params.toString()}`;
      console.log(`[Airbnb] Navigating to: ${targetUrl}`);

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Preemptively dismiss any cookie/overlay banner
      try {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            /accept|agree|동의|확인|close|닫기/i.test(b.innerText || '')
          );
          if (btn && btn.offsetHeight > 0) btn.click();
        });
      } catch {}

      // Trigger lazy loading
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(800);
      }

      const listings = await page.evaluate(({ lim, totalNights }) => {
        const cards = Array.from(document.querySelectorAll('[data-testid="card-container"]'));
        return cards.map(c => {
          const type = c.querySelector('[data-testid="listing-card-title"]')?.innerText?.trim() || '';
          const name = c.querySelector('[data-testid="listing-card-subtitle"]')?.innerText?.trim() || type;
          const linkEl = Array.from(c.querySelectorAll('a')).find(a => a.href.includes('/rooms/'));
          const link = linkEl ? linkEl.href.split('?')[0] : '';
          const lines = c.innerText.split('\n').map(s => s.trim()).filter(Boolean);

          let priceTotal = '';
          let rating = '';
          let roomsInfo = '';
          let badges = [];

          lines.forEach(l => {
            if (l === '게스트 선호' || l === '슈퍼호스트' || l === 'Guest favorite' || l === 'Superhost') {
              if (!badges.includes(l)) badges.push(l);
            }
            if (l.includes('총액') || (l.includes('₩') && l.includes('total'))) {
              priceTotal = l;
            } else if (l.startsWith('₩') && !priceTotal) {
              priceTotal = l;
            }
            if (l.includes('평점') || l.includes('★') || /^[0-9]\.[0-9]{1,2}/.test(l)) {
              if (!rating) rating = l;
            }
            if (l.includes('침실') || l.includes('침대') || l.includes('욕실') || l.includes('bedroom') || l.includes('bed') || l.includes('bath')) {
              roomsInfo = (roomsInfo ? roomsInfo + ' · ' : '') + l;
            }
          });

          return {
            name,
            type,
            badges,
            rating,
            roomsInfo,
            priceTotal,
            url: link
          };
        }).filter(item => item.url).slice(0, lim);
      }, { lim: opts.limit, totalNights: nights });

      console.log(JSON.stringify({
        status: 'SUCCESS',
        location: opts.location,
        query: opts.query,
        checkin: opts.checkin,
        checkout: opts.checkout,
        nights,
        beds: opts.beds,
        priceFilter: {
          pricePerNight: opts.pricePerNight,
          priceMin: pMin,
          priceMax: pMax
        },
        totalReturned: listings.length,
        listings
      }, null, 2));

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
        const sub = document.querySelector('[data-section-id="OVERVIEW_DEFAULT_V2"], [data-section-id="OVERVIEW_DEFAULT"]')?.innerText?.trim() || '';
        const desc = document.querySelector('[data-section-id="DESCRIPTION_DEFAULT"]')?.innerText?.trim() || '';
        const highlights = Array.from(document.querySelectorAll('[data-section-id="HIGHLIGHTS_DEFAULT"] div[role="group"], [data-section-id="HIGHLIGHTS_DEFAULT"] > div > div')).map(el => el.innerText.trim()).filter(Boolean);
        const amenities = Array.from(document.querySelectorAll('[data-section-id="AMENITIES_DEFAULT"] div[role="listitem"], [data-section-id="AMENITIES_DEFAULT"] li')).map(el => el.innerText.trim()).filter(Boolean);
        
        return {
          title,
          overview: sub.split('\n').map(s => s.trim()).filter(Boolean),
          highlights: highlights.slice(0, 4),
          descriptionSummary: desc.slice(0, 400),
          amenities: amenities.slice(0, 8)
        };
      });

      console.log(JSON.stringify(details, null, 2));

    } else {
      console.log(`Usage: node airbnb_runner.mjs search --location "..." [--checkin YYYY-MM-DD --checkout YYYY-MM-DD]`);
    }

  } catch (err) {
    console.error('Execution error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
