import { chromium } from 'playwright';

/**
 * Universal Hyperliquid Runner
 * Usage:
 *   node runner.mjs markets [--limit 20]
 *   node runner.mjs ticker --coin HYPE
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'markets';
  const options = { command, limit: 20 };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === '--coin' && args[i + 1]) options.coin = args[++i].toUpperCase();
  }
  return options;
}

async function fetchInfo(body) {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function main() {
  const opts = parseArgs();

  try {
    if (opts.command === 'markets') {
      const data = await fetchInfo({ type: 'metaAndAssetCtxs' });
      const universe = data[0].universe;
      const ctxs = data[1];

      const markets = universe.map((u, i) => {
        const ctx = ctxs[i];
        return {
          coin: u.name,
          maxLeverage: u.maxLeverage,
          markPx: parseFloat(ctx.markPx),
          prevDayPx: parseFloat(ctx.prevDayPx),
          change24h: ((parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx) * 100).toFixed(2) + '%',
          fundingRate: ctx.funding,
          openInterest: parseFloat(ctx.openInterest),
          dayVolumeUsd: parseFloat(ctx.dayNtlVlm)
        };
      });

      // Sort by 24h volume descending
      markets.sort((a, b) => b.dayVolumeUsd - a.dayVolumeUsd);

      console.log(JSON.stringify({
        totalMarkets: markets.length,
        showing: Math.min(markets.length, opts.limit),
        topMarkets: markets.slice(0, opts.limit)
      }, null, 2));

    } else if (opts.command === 'ticker') {
      if (!opts.coin) {
        console.error('Error: --coin is required for ticker command');
        process.exit(1);
      }

      const data = await fetchInfo({ type: 'metaAndAssetCtxs' });
      const universe = data[0].universe;
      const ctxs = data[1];

      const idx = universe.findIndex(u => u.name.toUpperCase() === opts.coin);
      if (idx === -1) {
        console.error(`Coin ${opts.coin} not found in Hyperliquid perps.`);
        process.exit(1);
      }

      const u = universe[idx];
      const ctx = ctxs[idx];
      const markPx = parseFloat(ctx.markPx);
      const prevPx = parseFloat(ctx.prevDayPx);

      console.log(JSON.stringify({
        coin: u.name,
        maxLeverage: u.maxLeverage,
        markPrice: markPx,
        prevDayPrice: prevPx,
        change24h: ((markPx - prevPx) / prevPx * 100).toFixed(2) + '%',
        fundingRate: ctx.funding,
        openInterest: parseFloat(ctx.openInterest),
        dayVolumeUsd: parseFloat(ctx.dayNtlVlm),
        oraclePrice: parseFloat(ctx.oraclePx)
      }, null, 2));

    } else {
      console.error(`Unknown command: ${opts.command}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Failed to execute:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
