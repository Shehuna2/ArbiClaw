import { JsonRpcProvider } from 'ethers';
import { parseConfig } from './config/env.js';
import { START_SYMBOL } from './config/tokens.js';
import { loadTokens } from './config/loadTokens.js';
import { Token } from './core/types.js';
import { formatFixed } from './core/math.js';
import { log } from './core/log.js';
import { AerodromeQuoter } from './dex/aerodrome/AerodromeQuoter.js';
import { UniswapV3Quoter } from './dex/uniswapv3/UniswapV3Quoter.js';
import { simulateTriangles, deriveEthToUsdcPrice } from './sim/simulate.js';
import { generateTriangles } from './sim/triangles.js';

const applySubset = (tokens: Token[], subset?: string[]): Token[] => {
  if (!subset || subset.length === 0) return tokens;
  const symbolSet = new Set(subset);
  if (!symbolSet.has(START_SYMBOL)) throw new Error(`--tokenSubset must include ${START_SYMBOL}`);
  const bySymbol = new Map(tokens.map((t) => [t.symbol, t]));
  for (const symbol of symbolSet) {
    if (!bySymbol.has(symbol)) throw new Error(`Token ${symbol} not found in registry.`);
  }
  return tokens.filter((t) => symbolSet.has(t.symbol));
};

const main = async () => {
  const cfg = parseConfig();
  const allTokens = await loadTokens(cfg.tokensPath);
  const selectedTokens = applySubset(allTokens, cfg.tokenSubset);
  const startToken = selectedTokens.find((token) => token.symbol === START_SYMBOL);
  if (!startToken) throw new Error(`Token registry must include ${START_SYMBOL}`);

  const adapters: { uniswapv3?: UniswapV3Quoter; aerodrome?: AerodromeQuoter } = {};
  for (const dex of cfg.dexes) {
    if (dex === 'uniswapv3') adapters.uniswapv3 = new UniswapV3Quoter(cfg.rpcUrl, cfg.fees);
    if (dex === 'aerodrome') adapters.aerodrome = new AerodromeQuoter(cfg.rpcUrl);
  }

  const enabledDexes = Object.keys(adapters).sort();
  if (!enabledDexes.length) throw new Error('No supported dexes enabled.');

  const midTokens = selectedTokens.filter((token) => token.symbol !== START_SYMBOL);
  const triangles = generateTriangles(startToken, midTokens, cfg.maxTriangles);

  log.info('scan-config', {
    rpc: cfg.rpcUrl,
    amount: cfg.amountInHuman,
    minProfit: cfg.minProfitHuman,
    top: cfg.topN,
    maxTriangles: cfg.maxTriangles,
    maxCombosPerTriangle: cfg.maxCombosPerTriangle,
    maxTotalQuotes: cfg.maxTotalQuotes,
    timeBudgetMs: cfg.timeBudgetMs,
    quoteConcurrency: cfg.quoteConcurrency,
    fees: cfg.fees,
    tokensPath: cfg.tokensPath,
    selectedTokens: selectedTokens.map((t) => t.symbol).sort(),
    dexes: enabledDexes,
    triangles: triangles.length
  });

  if (!triangles.length) {
    log.warn('No triangles generated.');
    return;
  }

  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const feeData = await provider.getFeeData();
  const gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas ?? 1_000_000_000n;

  const usdc = selectedTokens.find((t) => t.symbol === 'USDC');
  const weth = selectedTokens.find((t) => t.symbol === 'WETH');
  const ethToUsdcPrice = usdc && weth ? await deriveEthToUsdcPrice(adapters, usdc, weth) : 0;

  const { results, stats } = await simulateTriangles({
    adapters,
    triangles,
    startToken,
    amountInHuman: cfg.amountInHuman,
    minProfitHuman: cfg.minProfitHuman,
    gasPriceWei,
    ethToUsdcPrice,
    maxCombosPerTriangle: cfg.maxCombosPerTriangle,
    maxTotalQuotes: cfg.maxTotalQuotes,
    timeBudgetMs: cfg.timeBudgetMs,
    quoteConcurrency: cfg.quoteConcurrency
  });

  const winners = results.sort((a, b) => Number(b.netProfit - a.netProfit)).slice(0, cfg.topN);

  for (const [idx, row] of winners.entries()) {
    const route = row.hops.map((h) => `${h.tokenIn.symbol} -(${h.label})-> ${h.tokenOut.symbol}`).join(' ');
    log.info(`opportunity-${idx + 1}`, {
      route,
      grossProfitUSDC: formatFixed(row.grossProfit, startToken.decimals),
      gasCostUSDC: formatFixed(row.gasCostUsdc, startToken.decimals),
      netProfitUSDC: formatFixed(row.netProfit, startToken.decimals)
    });
  }

  log.info('stats', { ...stats });
};

main().catch((error) => {
  log.error('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
