import playwright from 'playwright';

/**
 * Universal LinkedIn Runner
 * 
 * Complies with the human-login-only policy: leverages existing authenticated Chrome sessions.
 * 
 * Usage:
 *   node linkedin_runner.mjs me                   # View current logged-in profile & basic stats
 *   node linkedin_runner.mjs feed [--limit 5]      # Read recent feed posts safely
 *   node linkedin_runner.mjs search --keywords "AI" [--type people|jobs] [--limit 10]
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'me';
  const options = { command, limit: 5, type: 'people', keywords: '' };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === '--type' && args[i + 1]) options.type = args[++i];
    else if (args[i] === '--keywords' && args[i + 1]) options.keywords = args[++i];
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
    let page = ctx.pages().find(p => p.url().includes('linkedin.com'));
    if (!page) page = await ctx.newPage();

    if (opts.command === 'me') {
      console.log('[LinkedIn] Fetching user profile state...');
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      const profile = await page.evaluate(() => {
        const isLogged = !document.querySelector('a[href*="/login"], button[data-tracking-control-name="guest_homepage-basic_nav-header-signin"]');
        const nameEl = document.querySelector('.feed-identity-module__actor-meta a, [class*="identity-module"] a, a[href*="/in/"]');
        const text = document.body.innerText;
        
        let userName = '';
        let title = '';
        const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
        const meIdx = lines.indexOf('Me') !== -1 ? lines.indexOf('Me') : lines.indexOf('MY PROFILE');
        if (meIdx !== -1 && lines[meIdx + 1]) {
          userName = lines[meIdx + 2] || lines[meIdx + 1];
          title = lines[meIdx + 3] || '';
        }

        return {
          isLoggedIn: isLogged,
          profileName: userName,
          headline: title,
          currentUrl: location.href
        };
      });

      console.log(JSON.stringify(profile, null, 2));

    } else if (opts.command === 'feed') {
      console.log(`[LinkedIn] Reading ${opts.limit} feed posts...`);
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Virtual DOM scroll down
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(1000);
      }

      const posts = await page.evaluate((lim) => {
        const candidates = Array.from(document.querySelectorAll('div, section, article')).filter(el => {
          const text = el.innerText || '';
          return (text.includes('Like') || text.includes('Comment') || text.includes('Repost') || text.includes('좋아요'))
            && text.length > 50 && text.length < 2500;
        });

        // Filter leaf containers
        const leaves = candidates.filter(c => !candidates.some(other => other !== c && c.contains(other)));

        return leaves.slice(0, lim).map(p => {
          const lines = p.innerText.split('\n').map(s => s.trim()).filter(Boolean);
          return {
            authorHeader: lines.slice(0, 3).join(' | '),
            contentSnippet: lines.slice(3, 8).join(' ')
          };
        });
      }, opts.limit);

      console.log(JSON.stringify({
        status: 'SUCCESS',
        count: posts.length,
        posts
      }, null, 2));

    } else if (opts.command === 'search') {
      if (!opts.keywords) {
        console.error('Error: --keywords is required for search');
        process.exit(1);
      }

      const searchType = opts.type === 'jobs' ? 'jobs' : 'people';
      const searchUrl = `https://www.linkedin.com/search/results/${searchType}/?keywords=${encodeURIComponent(opts.keywords)}`;
      console.log(`[LinkedIn] Searching ${searchType} for '${opts.keywords}'...`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);

      const items = await page.evaluate((lim) => {
        const links = Array.from(document.querySelectorAll('a[href*="/in/"], a[href*="/jobs/view/"]'));
        const seen = new Set();
        const results = [];

        links.forEach(a => {
          const href = a.href.split('?')[0];
          const text = a.innerText.trim();
          if (text && !seen.has(href) && !href.endsWith('/in/') && !href.endsWith('/jobs/view/')) {
            seen.add(href);
            const parent = a.closest('li, div[class*="entity"]');
            results.push({
              title: text.split('\n')[0],
              context: parent ? parent.innerText.split('\n').filter(Boolean).slice(1, 3).join(' | ') : '',
              url: href
            });
          }
        });

        return results.slice(0, lim);
      }, opts.limit);

      console.log(JSON.stringify({
        status: 'SUCCESS',
        type: searchType,
        keywords: opts.keywords,
        count: items.length,
        results: items
      }, null, 2));

    } else {
      console.log('Usage: node linkedin_runner.mjs [me | feed --limit N | search --keywords "..." --type people|jobs]');
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
