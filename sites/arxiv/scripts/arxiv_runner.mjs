import playwright from 'playwright';

/**
 * Universal arXiv Research Paper Runner
 * 
 * Usage:
 *   node arxiv_runner.mjs recent [--category cs.AI|cs.LG|cs.CL|cs.CV] [--limit 20]
 *   node arxiv_runner.mjs search --query "LLM Agent" [--limit 10]
 *   node arxiv_runner.mjs abstract --id "2609.12345"
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'recent';
  const options = {
    command,
    category: 'cs.AI',
    query: '',
    id: '',
    limit: 15
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) options.category = args[++i];
    else if (args[i] === '--query' && args[i + 1]) options.query = args[++i];
    else if (args[i] === '--id' && args[i + 1]) options.id = args[++i];
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
    let page = ctx.pages().find(p => p.url().includes('arxiv.org'));
    if (!page) page = await ctx.newPage();

    if (opts.command === 'recent') {
      const targetUrl = `https://arxiv.org/list/${opts.category}/recent`;
      console.log(`[arXiv] Fetching recent papers for ${opts.category}...`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2000);

      const papers = await page.evaluate((lim) => {
        const dts = Array.from(document.querySelectorAll('dt'));
        const dds = Array.from(document.querySelectorAll('dd'));
        const list = [];

        for (let i = 0; i < Math.min(dts.length, dds.length, lim); i++) {
          const dt = dts[i];
          const dd = dds[i];

          const arxivId = dt.querySelector('a[title="Abstract"]')?.innerText?.trim() || '';
          const pdfLink = dt.querySelector('a[title="Download PDF"]')?.href || '';
          const title = dd.querySelector('.list-title')?.innerText?.replace(/^Title:\s*/i, '').trim() || '';
          const authors = dd.querySelector('.list-authors')?.innerText?.replace(/^Authors:\s*/i, '').trim() || '';
          const subjects = dd.querySelector('.list-subjects')?.innerText?.replace(/^Subjects:\s*/i, '').trim() || '';

          list.push({
            id: arxivId,
            title,
            authors,
            subjects,
            pdf: pdfLink
          });
        }
        return list;
      }, opts.limit);

      console.log(JSON.stringify({
        status: 'SUCCESS',
        category: opts.category,
        total: papers.length,
        papers
      }, null, 2));

    } else if (opts.command === 'search') {
      if (!opts.query) {
        console.error('Error: --query is required for search');
        process.exit(1);
      }
      const searchUrl = `https://arxiv.org/search/?query=${encodeURIComponent(opts.query)}&searchtype=all&source=header`;
      console.log(`[arXiv] Searching query: ${opts.query}...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      const results = await page.evaluate((lim) => {
        const items = Array.from(document.querySelectorAll('li.arxiv-result'));
        return items.slice(0, lim).map(el => {
          const title = el.querySelector('p.title')?.innerText?.trim() || '';
          const authors = el.querySelector('p.authors')?.innerText?.replace(/^Authors:\s*/i, '').trim() || '';
          const abstract = el.querySelector('span.abstract-full')?.innerText?.replace(/\s+/g, ' ').trim() || '';
          const link = el.querySelector('a[href*="/abs/"]')?.href || '';
          return { title, authors, abstract: abstract.slice(0, 200) + '...', link };
        });
      }, opts.limit);

      console.log(JSON.stringify({
        status: 'SUCCESS',
        query: opts.query,
        count: results.length,
        results
      }, null, 2));

    } else if (opts.command === 'abstract') {
      if (!opts.id) {
        console.error('Error: --id is required for abstract (e.g. 2609.12345)');
        process.exit(1);
      }
      const absUrl = opts.id.startsWith('http') ? opts.id : `https://arxiv.org/abs/${opts.id.replace('arXiv:', '')}`;
      console.log(`[arXiv] Reading abstract from ${absUrl}...`);
      await page.goto(absUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2000);

      const data = await page.evaluate(() => {
        const title = document.querySelector('h1.title')?.innerText?.replace(/^Title:\s*/i, '').trim() || '';
        const abstract = document.querySelector('blockquote.abstract')?.innerText?.replace(/^Abstract:\s*/i, '').trim() || '';
        const subjects = document.querySelector('td.subjects')?.innerText?.trim() || '';
        return { title, subjects, abstract };
      });

      console.log(JSON.stringify(data, null, 2));

    } else {
      console.log('Usage: node arxiv_runner.mjs recent [--category cs.AI|cs.LG] [--limit 15]');
    }

    await page.close();

  } catch (err) {
    console.error('Execution failed:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
