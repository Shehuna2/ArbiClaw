import { JsonRpcProvider } from 'ethers';
import { parseConfig } from './config/env.js';
import { START_SYMBOL } from './config/tokens.js';
import { loadTokens } from './config/loadTokens.js';
import { Token } from './core/types.js';
import { cmpBigintDesc, formatFixed, toUnits } from './core/math.js';
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

const runSelfTest = async (
  adapters: { uniswapv3?: UniswapV3Quoter; aerodrome?: AerodromeQuoter },
  selectedTokens: Token[]
): Promise<boolean> => {
  const usdc = selectedTokens.find((t) => t.symbol === 'USDC');
  const weth = selectedTokens.find((t) => t.symbol === 'WETH');
  if (!usdc || !weth) throw new Error('Self-test requires USDC and WETH in token set.');

  const amountIn = toUnits(100, usdc.decimals);
  let success = 0;

  if (adapters.uniswapv3) {
    for (const fee of [500, 3000, 10000]) {
      const q = await adapters.uniswapv3.quoteWithFee(usdc, weth, amountIn, fee);
      if (q) {
        success += 1;
        console.log(JSON.stringify({ dex: 'uniswapv3', pair: 'USDC/WETH', mode: `fee:${fee}`, ok: true, amountOut: q.amountOut.toString() }));
      } else {
        console.log(JSON.stringify({ dex: 'uniswapv3', pair: 'USDC/WETH', mode: `fee:${fee}`, ok: false, err: adapters.uniswapv3.getLastError() }));
      }
    }
  }

  if (adapters.aerodrome) {
    for (const stable of [false, true]) {
      const q = await adapters.aerodrome.quoteByMode(usdc, weth, amountIn, stable);
      if (q) {
        success += 1;
        console.log(JSON.stringify({ dex: 'aerodrome', pair: 'USDC/WETH', mode: stable ? 'stable' : 'volatile', ok: true, amountOut: q.amountOut.toString() }));
      } else {
        console.log(JSON.stringify({ dex: 'aerodrome', pair: 'USDC/WETH', mode: stable ? 'stable' : 'volatile', ok: false, err: adapters.aerodrome.getLastError() }));
      }
    }
  }

  const aero = selectedTokens.find((t) => t.symbol === 'AERO');
  if (aero) {
    if (adapters.uniswapv3) {
      const qa = await adapters.uniswapv3.quoteWithFee(usdc, aero, amountIn, 3000);
      console.log(JSON.stringify({ dex: 'uniswapv3', pair: 'USDC/AERO', ok: !!qa, amountOut: qa?.amountOut.toString(), err: qa ? undefined : adapters.uniswapv3.getLastError() }));
      if (qa) success += 1;
      const qb = await adapters.uniswapv3.quoteWithFee(aero, usdc, toUnits(10, aero.decimals), 3000);
      console.log(JSON.stringify({ dex: 'uniswapv3', pair: 'AERO/USDC', ok: !!qb, amountOut: qb?.amountOut.toString(), err: qb ? undefined : adapters.uniswapv3.getLastError() }));
      if (qb) success += 1;
    }
    if (adapters.aerodrome) {
      for (const [pairIn, pairOut, pairName, amount] of [
        [usdc, aero, 'USDC/AERO', amountIn],
        [aero, usdc, 'AERO/USDC', toUnits(10, aero.decimals)]
      ] as const) {
        const qVol = await adapters.aerodrome.quoteByMode(pairIn, pairOut, amount, false);
        const qSt = await adapters.aerodrome.quoteByMode(pairIn, pairOut, amount, true);
        const best = !qVol ? qSt : !qSt ? qVol : qVol.amountOut > qSt.amountOut ? qVol : qSt;
        console.log(JSON.stringify({ dex: 'aerodrome', pair: pairName, ok: !!best, amountOut: best?.amountOut.toString(), err: best ? undefined : adapters.aerodrome.getLastError() }));
        if (best) success += 1;
      }
    }
  }

  return success > 0;
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

  if (cfg.selfTest) {
    const ok = await runSelfTest(adapters, selectedTokens);
    if (!ok) {
      process.exit(1);
    }
    return;
  }

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
    selfTest: cfg.selfTest,
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

  const winners = results.sort((a, b) => cmpBigintDesc(a.netProfit, b.netProfit)).slice(0, cfg.topN);

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
