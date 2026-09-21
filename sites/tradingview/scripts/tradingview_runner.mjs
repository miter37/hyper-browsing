import playwright from 'playwright';

/**
 * Universal TradingView Chart & OHLCV Runner
 * 
 * Extracts real-time Open, High, Low, Close, Volume and price changes directly from
 * TradingView's canvas overlay layers without needing external API keys.
 * 
 * Usage:
 *   node tradingview_runner.mjs quote --symbol "BINANCE:BTCUSDT"
 *   node tradingview_runner.mjs quote --symbol "NASDAQ:NVDA"
 *   node tradingview_runner.mjs quote --symbol "KRX:005930"
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'quote';
  const options = { command, symbol: 'BINANCE:BTCUSDT' };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) options.symbol = args[++i].toUpperCase();
    else if (args[i] === '--interval' && args[i + 1]) options.interval = args[++i];
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

function parseLegend(rawText) {
  const lines = rawText.split('\n').map(s => s.trim()).filter(Boolean);
  const result = {};

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === '시' || l === 'Open' || l === 'O') result.open = lines[i + 1];
    else if (l === '고' || l === 'High' || l === 'H') result.high = lines[i + 1];
    else if (l === '저' || l === 'Low' || l === 'L') result.low = lines[i + 1];
    else if (l === '종' || l === 'Close' || l === 'C') result.close = lines[i + 1];
    else if (l === '볼륨' || l === 'Volume' || l === 'Vol') result.volume = lines[i + 1];
  }

  // Find change percentage (e.g. "+2.93 (+1.34%)")
  const changeLine = lines.find(l => /\([+-]?[0-9.]+\%\)/.test(l));
  if (changeLine) result.change = changeLine;

  return result;
}

async function main() {
  const opts = parseArgs();
  let browser;

  try {
    browser = await connectBrowser();
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find(p => p.url().includes('tradingview.com'));
    if (!page) page = await ctx.newPage();

    const chartUrl = `https://kr.tradingview.com/chart/?symbol=${encodeURIComponent(opts.symbol)}`;
    console.log(`[TradingView] Loading chart for ${opts.symbol}...`);
    await page.goto(chartUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(4000);

    const title = await page.title();

    // Extract Legend Overlay
    const rawLegend = await page.evaluate(() => {
      const wrappers = Array.from(document.querySelectorAll('[class*="valuesWrapper-"], [class*="legend-"]'));
      const found = wrappers.map(w => w.innerText.trim()).filter(t => t.includes('시') || t.includes('종') || t.includes('고'));
      return found[0] || '';
    });

    const parsedOhlc = parseLegend(rawLegend);

    console.log(JSON.stringify({
      status: 'SUCCESS',
      symbol: opts.symbol,
      pageTitle: title,
      currentPrice: parsedOhlc.close || title.split(' ')[1] || '',
      change: parsedOhlc.change || '',
      ohlcv: {
        open: parsedOhlc.open || '',
        high: parsedOhlc.high || '',
        low: parsedOhlc.low || '',
        close: parsedOhlc.close || '',
        volume: parsedOhlc.volume || ''
      },
      source: 'TradingView Canvas DOM HUD Overlay'
    }, null, 2));

    await page.close();

  } catch (err) {
    console.error('Execution error:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
