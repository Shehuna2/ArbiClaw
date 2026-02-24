import { parseConfig } from './config/env.js';
import { START_TOKEN, TRIANGLE_TOKENS } from './config/tokens.js';
import { formatFixed } from './core/math.js';
import { log } from './core/log.js';
import { UniswapV3Quoter } from './dex/uniswapv3/quoter.js';
import { generateTriangles } from './sim/triangles.js';
import { simulateRoutes } from './sim/simulate.js';

const main = async () => {
  const cfg = parseConfig();
  const routes = generateTriangles(START_TOKEN, TRIANGLE_TOKENS, cfg.fees, cfg.maxTriangles);

  log.info('scan-config', {
    rpc: cfg.rpcUrl,
    amount: cfg.amountInHuman,
    minProfit: cfg.minProfitHuman,
    top: cfg.topN,
    maxTriangles: cfg.maxTriangles,
    fees: cfg.fees,
    triangles: routes.length
  });

  if (!routes.length) {
    log.warn('No triangles generated.');
    return;
  }

  const quoter = new UniswapV3Quoter(cfg.rpcUrl);
  const results = await simulateRoutes({
    quoter,
    routes,
    startToken: START_TOKEN,
    amountInHuman: cfg.amountInHuman,
    minProfitHuman: cfg.minProfitHuman
  });

  const winners = results
    .filter((r) => !r.failed)
    .sort((a, b) => Number(b.netProfit - a.netProfit))
    .slice(0, cfg.topN);

  if (!winners.length) {
    log.info('No profitable opportunities found.');
  }

  for (const [idx, row] of winners.entries()) {
    const route = row.route.hops.map((h) => `${h.tokenIn.symbol}-${h.tokenOut.symbol}@${h.fee}`).join(' | ');
    log.info(`opportunity-${idx + 1}`, {
      route,
      grossProfitUSDC: formatFixed(row.grossProfit, START_TOKEN.decimals),
      gasCostUSDC: formatFixed(row.gasCostUsdc, START_TOKEN.decimals),
      netProfitUSDC: formatFixed(row.netProfit, START_TOKEN.decimals)
    });
  }

  const failures = results.filter((r) => r.failed && r.failReason);
  if (failures.length) {
    log.warn('Skipped failing routes', { count: failures.length, sample: failures.slice(0, 3).map((x) => x.failReason) });
  }
};

main().catch((error) => {
  log.error('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
