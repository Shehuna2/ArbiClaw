import { parseConfig } from './config/env.js';
import { START_SYMBOL } from './config/tokens.js';
import { loadTokens } from './config/loadTokens.js';
import { Token } from './core/types.js';
import { formatFixed } from './core/math.js';
import { log } from './core/log.js';
import { UniswapV3Quoter } from './dex/uniswapv3/quoter.js';
import { generateTriangles } from './sim/triangles.js';
import { simulateRoutes } from './sim/simulate.js';

const applySubset = (tokens: Token[], subset?: string[]): Token[] => {
  if (!subset || subset.length === 0) return tokens;

  const symbolSet = new Set(subset);
  if (!symbolSet.has(START_SYMBOL)) {
    throw new Error(`--tokenSubset must include ${START_SYMBOL}`);
  }

  const bySymbol = new Map(tokens.map((t) => [t.symbol, t]));
  for (const symbol of symbolSet) {
    if (!bySymbol.has(symbol)) {
      throw new Error(`Token ${symbol} not found in registry.`);
    }
  }

  return tokens.filter((t) => symbolSet.has(t.symbol));
};

const main = async () => {
  const cfg = parseConfig();
  const allTokens = await loadTokens(cfg.tokensPath);
  const selectedTokens = applySubset(allTokens, cfg.tokenSubset);
  const startToken = selectedTokens.find((token) => token.symbol === START_SYMBOL);
  if (!startToken) {
    throw new Error(`Token registry must include ${START_SYMBOL}`);
  }

  const midTokens = selectedTokens.filter((token) => token.symbol !== START_SYMBOL);
  const routes = generateTriangles(startToken, midTokens, cfg.fees, cfg.maxTriangles);

  log.info('scan-config', {
    rpc: cfg.rpcUrl,
    amount: cfg.amountInHuman,
    minProfit: cfg.minProfitHuman,
    top: cfg.topN,
    maxTriangles: cfg.maxTriangles,
    fees: cfg.fees,
    tokensPath: cfg.tokensPath,
    selectedTokens: selectedTokens.map((t) => t.symbol).sort(),
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
    startToken,
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
      grossProfitUSDC: formatFixed(row.grossProfit, startToken.decimals),
      gasCostUSDC: formatFixed(row.gasCostUsdc, startToken.decimals),
      netProfitUSDC: formatFixed(row.netProfit, startToken.decimals)
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
