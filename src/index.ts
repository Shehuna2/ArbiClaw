import { JsonRpcProvider } from 'ethers';
import { parseConfig } from './config/env.js';
import { loadFeePrefs } from './config/fees.js';
import { buildStableConfig, loadStablePairOverrides } from './config/stables.js';
import { START_SYMBOL } from './config/tokens.js';
import { loadTokens } from './config/loadTokens.js';
import { Token, RouteCandidate, SimStats } from './core/types.js';
import { cmpBigintDesc, formatFixed, toUnits } from './core/math.js';
import { log } from './core/log.js';
import { AerodromeQuoter } from './dex/aerodrome/AerodromeQuoter.js';
import { UniswapV3Quoter } from './dex/uniswapv3/UniswapV3Quoter.js';
import { simulateTriangles, deriveEthToUsdcPrice, getTriangleHopOptions } from './sim/simulate.js';
import { generateTriangles } from './sim/triangles.js';

const applySubset = (tokens: Token[], subset?: string[]): Token[] => {
  if (!subset || subset.length === 0) return tokens;
  const symbolSet = new Set(subset.map((s) => s.toUpperCase()));
  if (!symbolSet.has(START_SYMBOL)) throw new Error(`--tokenSubset must include ${START_SYMBOL}`);
  const bySymbol = new Map(tokens.map((t) => [t.symbol.toUpperCase(), t]));
  for (const symbol of symbolSet) {
    if (!bySymbol.has(symbol)) throw new Error(`Token ${symbol} not found in registry.`);
  }
  return tokens.filter((t) => symbolSet.has(t.symbol.toUpperCase()));
};


const assertAerodromeCalldataEncoding = (adapters: { aerodrome?: AerodromeQuoter }, usdc: Token, weth: Token, debugHops: boolean, selfTest: boolean): boolean => {
  if (!adapters.aerodrome || (!debugHops && !selfTest)) return true;
  const amountIn = toUnits('100', usdc.decimals);
  const calldata = adapters.aerodrome.encodeGetAmountsOutCalldata(usdc.address, weth.address, amountIn, false);
  const selector = calldata.slice(0, 10);
  const firstWord = calldata.slice(10, 74);
  const first20Bytes = calldata.slice(0, 42);
  const expectedAmountWord = amountIn.toString(16).padStart(64, '0');

  log.info('aerodrome-calldata-check', {
    pair: 'USDC/WETH',
    selector,
    first20Bytes,
    firstWordPrefix: firstWord.slice(0, 16)
  });

  if (firstWord !== expectedAmountWord) {
    log.error('aerodrome-calldata-invalid', { expectedAmountWordPrefix: expectedAmountWord.slice(0, 16), gotPrefix: firstWord.slice(0, 16) });
    return false;
  }

  return true;
};

const runSelfTest = async (
  adapters: { uniswapv3?: UniswapV3Quoter; aerodrome?: AerodromeQuoter },
  selectedTokens: Token[]
): Promise<boolean> => {
  const usdc = selectedTokens.find((t) => t.symbol === 'USDC');
  const weth = selectedTokens.find((t) => t.symbol === 'WETH');
  if (!usdc || !weth) throw new Error('Self-test requires USDC and WETH in token set.');

  if (!assertAerodromeCalldataEncoding(adapters, usdc, weth, false, true)) return false;

  const amountIn = toUnits('100', usdc.decimals);
  let success = 0;
  let uniUsdcWethOk = false;
  let aeroVolUsdcWethOk = false;

  if (adapters.uniswapv3) {
    for (const fee of [500, 3000, 10000]) {
      const q = await adapters.uniswapv3.quoteWithFee(usdc, weth, amountIn, fee);
      console.log(JSON.stringify({ dex: 'uniswapv3', pair: 'USDC/WETH', mode: `fee:${fee}`, ok: !!q, amountOut: q?.amountOut.toString(), err: q ? undefined : adapters.uniswapv3.getLastError() }));
      if (q) {
        success += 1;
        uniUsdcWethOk = true;
      }
    }
  }

  if (adapters.aerodrome) {
    const qVol = await adapters.aerodrome.quoteByMode(usdc, weth, amountIn, false);
    console.log(JSON.stringify({ dex: 'aerodrome', pair: 'USDC/WETH', mode: 'volatile', ok: !!qVol, amountOut: qVol?.amountOut.toString(), err: qVol ? undefined : adapters.aerodrome.getLastError() }));
    if (qVol) {
      success += 1;
      aeroVolUsdcWethOk = true;
    }

    if (adapters.aerodrome.canUseStable(usdc, weth)) {
      const qStable = await adapters.aerodrome.quoteByMode(usdc, weth, amountIn, true);
      console.log(JSON.stringify({ dex: 'aerodrome', pair: 'USDC/WETH', mode: 'stable', ok: !!qStable, amountOut: qStable?.amountOut.toString(), err: qStable ? undefined : adapters.aerodrome.getLastError() }));
      if (qStable) success += 1;
    } else {
      console.log(JSON.stringify({ dex: 'aerodrome', pair: 'USDC/WETH', mode: 'stable', ok: false, skipped: true, err: 'STABLE_SKIPPED: pair not stable-eligible' }));
    }
  }

  if (!aeroVolUsdcWethOk && adapters.aerodrome) {
    console.error('Self-test failed: aerodrome volatile USDC->WETH quote failed.');
    return false;
  }

  if (!uniUsdcWethOk && adapters.uniswapv3) {
    console.error('Self-test failed: uniswapv3 USDC->WETH quote failed for all fee tiers.');
    return false;
  }

  if (!uniUsdcWethOk && !aeroVolUsdcWethOk) {
    console.error('Self-test failed: both uniswapv3 and aerodrome volatile USDC->WETH quotes failed.');
    return false;
  }

  return success > 0;
};

const summarizeHopDebug = (hop: Awaited<ReturnType<typeof getTriangleHopOptions>>[number]) => ({
  pair: `${hop.debug.tokenIn}->${hop.debug.tokenOut}`,
  optionCount: hop.options.length,
  dexCounts: hop.debug.dexCounts,
  optionLabelsSample: hop.debug.optionLabels.slice(0, 8)
});

const filterTrianglesWithHopOptions = async (
  triangles: RouteCandidate[],
  adapters: { uniswapv3?: UniswapV3Quoter; aerodrome?: AerodromeQuoter },
  feePrefs: Awaited<ReturnType<typeof loadFeePrefs>>,
  debugHops: boolean
): Promise<RouteCandidate[]> => {
  const filtered: RouteCandidate[] = [];
  let logged = 0;

  for (const triangle of triangles) {
    const [hop1, hop2, hop3] = await getTriangleHopOptions(triangle, adapters, feePrefs);

    if (debugHops && logged < 10) {
      log.info('hop-options', {
        route: triangle.id,
        hops: [summarizeHopDebug(hop1), summarizeHopDebug(hop2), summarizeHopDebug(hop3)]
      });
      logged += 1;
    }

    const missing: string[] = [];
    if (hop1.options.length === 0) missing.push('hop1');
    if (hop2.options.length === 0) missing.push('hop2');
    if (hop3.options.length === 0) missing.push('hop3');

    if (missing.length > 0) {
      if (debugHops && logged < 5) {
        log.warn('skip-triangle', {
          route: triangle.id,
          missing,
          details: {
            hop1Options: hop1.options.length,
            hop2Options: hop2.options.length,
            hop3Options: hop3.options.length
          },
          uniChecks: [hop1.debug.uniPoolChecks, hop2.debug.uniPoolChecks, hop3.debug.uniPoolChecks]
        });
        logged += 1;
      }
      continue;
    }

    filtered.push(triangle);
  }

  return filtered;
};

const emptyStats = (trianglesSkippedNoHopOptions: number): SimStats => ({
  trianglesConsidered: 0,
  combosEnumerated: 0,
  trianglesSkippedNoHopOptions,
  quoteAttempts: 0,
  quoteFailures: 0,
  hop1OptionsAvg: 0,
  hop2OptionsAvg: 0,
  hop3OptionsAvg: 0,
  hop1OptionsMin: 0,
  hop2OptionsMin: 0,
  hop3OptionsMin: 0,
  hop1OptionsMax: 0,
  hop2OptionsMax: 0,
  hop3OptionsMax: 0,
  errorsByDex: {},
  errorsByHop: {},
  topErrorsByDex: {}
});

const main = async () => {
  const cfg = parseConfig();
  const feePrefs = await loadFeePrefs(cfg.feeConfigPath);
  const allTokens = await loadTokens(cfg.tokensPath);
  const selectedTokens = applySubset(allTokens, cfg.tokenSubset);
  const stablePairOverrides = await loadStablePairOverrides(cfg.aeroStablePairsPath);
  const stableConfig = buildStableConfig(selectedTokens, stablePairOverrides);

  const startToken = selectedTokens.find((token) => token.symbol === START_SYMBOL);
  if (!startToken) throw new Error(`Token registry must include ${START_SYMBOL}`);

  const adapters: { uniswapv3?: UniswapV3Quoter; aerodrome?: AerodromeQuoter } = {};
  for (const dex of cfg.dexes) {
    if (dex === 'uniswapv3') adapters.uniswapv3 = new UniswapV3Quoter(cfg.rpcUrl, cfg.fees);
    if (dex === 'aerodrome') adapters.aerodrome = new AerodromeQuoter(cfg.rpcUrl, stableConfig);
  }

  const enabledDexes = Object.keys(adapters).sort();
  if (!enabledDexes.length) throw new Error('No supported dexes enabled.');

  const usdc = selectedTokens.find((t) => t.symbol === 'USDC');
  const weth = selectedTokens.find((t) => t.symbol === 'WETH');
  if (usdc && weth && !assertAerodromeCalldataEncoding(adapters, usdc, weth, cfg.debugHops, false)) {
    process.exit(1);
  }

  if (cfg.selfTest) {
    const ok = await runSelfTest(adapters, selectedTokens);
    if (!ok) process.exit(1);
    return;
  }

  const midTokens = selectedTokens.filter((token) => token.symbol !== START_SYMBOL);
  const triangleCandidates = generateTriangles(startToken, midTokens, cfg.maxTriangles);
  const triangles = await filterTrianglesWithHopOptions(triangleCandidates, adapters, feePrefs, cfg.debugHops);
  const trianglesSkippedNoHopOptions = triangleCandidates.length - triangles.length;

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
    debugHops: cfg.debugHops,
    fees: cfg.fees,
    feeConfigPath: cfg.feeConfigPath,
    aeroStablePairsPath: cfg.aeroStablePairsPath,
    tokensPath: cfg.tokensPath,
    selectedTokens: selectedTokens.map((t) => t.symbol).sort(),
    dexes: enabledDexes,
    triangles: triangles.length,
    triangleCandidates: triangleCandidates.length,
    trianglesSkippedNoHopOptions
  });

  if (!triangles.length) {
    log.warn('No triangles generated after hop-option filtering.');
    log.info('stats', { ...emptyStats(trianglesSkippedNoHopOptions) });
    return;
  }

  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const feeData = await provider.getFeeData();
  const gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas ?? 1_000_000_000n;

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
    quoteConcurrency: cfg.quoteConcurrency,
    feePrefs,
    debugHops: cfg.debugHops
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

  log.info('stats', { ...stats, trianglesSkippedNoHopOptions: stats.trianglesSkippedNoHopOptions + trianglesSkippedNoHopOptions });
};

main().catch((error) => {
  log.error('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
