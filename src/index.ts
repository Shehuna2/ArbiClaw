import { JsonRpcProvider } from 'ethers';
import { parseConfig } from './config/env.js';
import { START_SYMBOL } from './config/tokens.js';
import { loadTokens } from './config/loadTokens.js';
import { Token } from './core/types.js';
import { formatFixed, fromUnits } from './core/math.js';
import { log } from './core/log.js';
import { DexQuoter } from './dex/DexQuoter.js';
import { AerodromeQuoter } from './dex/aerodrome/AerodromeQuoter.js';
import { UniswapV3Quoter } from './dex/uniswapv3/UniswapV3Quoter.js';
import { generateTriangles } from './sim/triangles.js';
import { simulateRoutes } from './sim/simulate.js';

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

const buildDexQuoters = (rpcUrl: string, dexes: string[], fees: number[]): Map<string, DexQuoter> => {
  const out = new Map<string, DexQuoter>();

  for (const dex of dexes) {
    if (dex === 'uniswapv3') {
      out.set(dex, new UniswapV3Quoter(rpcUrl, fees));
      continue;
    }
    if (dex === 'aerodrome') {
      out.set(dex, new AerodromeQuoter(rpcUrl));
      continue;
    }
    throw new Error(`Unsupported dex: ${dex}`);
  }

  return out;
};

const deriveEthToUsdcPrice = async (quoters: Map<string, DexQuoter>, tokens: Token[]): Promise<number> => {
  const usdc = tokens.find((t) => t.symbol === 'USDC');
  const weth = tokens.find((t) => t.symbol === 'WETH');
  if (!usdc || !weth) return 0;

  for (const quoter of quoters.values()) {
    const quote = await quoter.quoteExactIn({ tokenIn: weth, tokenOut: usdc, amountIn: 10n ** 18n });
    if (quote && quote.amountOut > 0n) {
      return fromUnits(quote.amountOut, usdc.decimals);
    }
  }

  return 0;
};

const main = async () => {
  const cfg = parseConfig();
  const allTokens = await loadTokens(cfg.tokensPath);
  const selectedTokens = applySubset(allTokens, cfg.tokenSubset);
  const startToken = selectedTokens.find((token) => token.symbol === START_SYMBOL);
  if (!startToken) throw new Error(`Token registry must include ${START_SYMBOL}`);

  const dexQuoters = buildDexQuoters(cfg.rpcUrl, cfg.dexes, cfg.fees);
  const enabledDexes = [...dexQuoters.keys()].sort();
  const midTokens = selectedTokens.filter((token) => token.symbol !== START_SYMBOL);
  const routes = generateTriangles(startToken, midTokens, enabledDexes, cfg.maxTriangles);

  log.info('scan-config', {
    rpc: cfg.rpcUrl,
    amount: cfg.amountInHuman,
    minProfit: cfg.minProfitHuman,
    top: cfg.topN,
    maxTriangles: cfg.maxTriangles,
    fees: cfg.fees,
    tokensPath: cfg.tokensPath,
    selectedTokens: selectedTokens.map((t) => t.symbol).sort(),
    dexes: enabledDexes,
    triangles: routes.length
  });

  if (routes.length > 0) {
    const sampleHop = routes[0].hops.map((h) => `${h.dex}:${h.tokenIn.symbol}->${h.tokenOut.symbol}`).join(' | ');
    log.info('sample-route', { id: routes[0].id, hops: sampleHop });
  }

  if (!routes.length) {
    log.warn('No triangles generated.');
    return;
  }

  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const feeData = await provider.getFeeData();
  const gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas ?? 1_000_000_000n;
  const ethToUsdcPrice = await deriveEthToUsdcPrice(dexQuoters, selectedTokens);

  const results = await simulateRoutes({
    dexQuoters,
    routes,
    startToken,
    amountInHuman: cfg.amountInHuman,
    minProfitHuman: cfg.minProfitHuman,
    gasPriceWei,
    ethToUsdcPrice
  });

  const winners = results.filter((r) => !r.failed).sort((a, b) => Number(b.netProfit - a.netProfit)).slice(0, cfg.topN);

  if (!winners.length) {
    log.info('No profitable opportunities found.');
  }

  for (const [idx, row] of winners.entries()) {
    const route = row.route.hops.map((h) => `${h.dex}:${h.tokenIn.symbol}-${h.tokenOut.symbol}`).join(' | ');
    log.info(`opportunity-${idx + 1}`, {
      route,
      grossProfitUSDC: formatFixed(row.grossProfit, startToken.decimals),
      gasCostUSDC: formatFixed(row.gasCostUsdc, startToken.decimals),
      netProfitUSDC: formatFixed(row.netProfit, startToken.decimals)
    });
  }

  const failures = results.filter((r) => r.failed && r.failReason);
  if (failures.length) {
    log.warn('Skipped failing routes', {
      count: failures.length,
      sample: failures.slice(0, 3).map((x) => `${x.route.id} => ${x.failReason}`)
    });
  }
};

main().catch((error) => {
  log.error('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
