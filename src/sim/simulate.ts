import { FeePrefs } from '../config/fees.js';
import { fromUnits, toUnits } from '../core/math.js';
import { log } from '../core/log.js';
import { RouteHop, SimResult, SimStats, Token, RouteCandidate } from '../core/types.js';
import { DexAdapters, HopOption, HopOptionsBuild, buildHopOptions } from './hopOptions.js';
import { runLimited } from '../utils/concurrency.js';


export interface TriangleWithHopOptions {
  triangle: RouteCandidate;
  hopOptions: [HopOptionsBuild, HopOptionsBuild, HopOptionsBuild];
}

interface SimulateParams {
  adapters: DexAdapters;
  triangles: TriangleWithHopOptions[];
  startToken: Token;
  amountInHuman: string;
  minProfitHuman: string;
  gasPriceWei: bigint;
  ethToUsdcPrice: number;
  maxCombosPerTriangle: number;
  maxTotalQuotes: number;
  timeBudgetMs: number;
  quoteConcurrency: number;
  feePrefs: FeePrefs;
  debugHops: boolean;
  traceAmounts: boolean;
}

interface SimulateOutput {
  results: SimResult[];
  stats: SimStats;
}

const pushTopError = (stats: SimStats, dexId: string, summary: string) => {
  if (!summary) return;
  if (!stats.topErrorsByDex[dexId]) stats.topErrorsByDex[dexId] = [];
  if (!stats.topErrorsByDex[dexId].includes(summary) && stats.topErrorsByDex[dexId].length < 5) {
    stats.topErrorsByDex[dexId].push(summary);
  }
};


const classifyErrorSummary = (summary: string): 'timeouts' | 'callExceptions' | 'other' => {
  const upper = summary.toUpperCase();
  if (upper.includes('TIMEOUT') || upper.includes('ETIMEDOUT')) return 'timeouts';
  if (upper.includes('CALL_EXCEPTION') || upper.includes('CALL EXCEPTION')) return 'callExceptions';
  return 'other';
};

const markError = (stats: SimStats, dexId: string, hopKey: string, summary: string, debugHops: boolean) => {
  if (dexId === 'aerodrome' && summary.startsWith('STABLE_REVERT_EXPECTED') && !debugHops) return;
  stats.quoteFailures += 1;
  stats.errorsByDex[dexId] = (stats.errorsByDex[dexId] ?? 0) + 1;
  stats.errorsByHop[hopKey] = (stats.errorsByHop[hopKey] ?? 0) + 1;
  if (!stats.errorTypeCountersByDex[dexId]) stats.errorTypeCountersByDex[dexId] = { timeouts: 0, callExceptions: 0, other: 0 };
  const bucket = classifyErrorSummary(summary);
  stats.errorTypeCountersByDex[dexId][bucket] += 1;
  pushTopError(stats, dexId, summary);
};

const getLastDexError = (adapters: DexAdapters, dexId: string, debugHops: boolean): string => {
  if (dexId === 'uniswapv3') return adapters.uniswapv3?.getLastError() ?? 'quote failed';
  if (dexId === 'aerodrome') return adapters.aerodrome?.getLastError(debugHops) ?? 'quote failed';
  return 'quote failed';
};

export const getTriangleHopOptions = async (
  triangle: RouteCandidate,
  adapters: DexAdapters,
  feePrefs: FeePrefs
): Promise<[HopOptionsBuild, HopOptionsBuild, HopOptionsBuild]> => {
  const [a, b, c] = triangle.tokens;
  return Promise.all([
    buildHopOptions({ tokenIn: a, tokenOut: b, adapters, feePrefs }),
    buildHopOptions({ tokenIn: b, tokenOut: c, adapters, feePrefs }),
    buildHopOptions({ tokenIn: c, tokenOut: a, adapters, feePrefs })
  ]);
};

export const simulateTriangles = async (params: SimulateParams): Promise<SimulateOutput> => {
  const {
    adapters,
    triangles,
    startToken,
    amountInHuman,
    minProfitHuman,
    gasPriceWei,
    ethToUsdcPrice,
    maxCombosPerTriangle,
    maxTotalQuotes,
    timeBudgetMs,
    quoteConcurrency,
    feePrefs,
    debugHops,
    traceAmounts
  } = params;

  const startAmount = toUnits(amountInHuman, startToken.decimals);
  void minProfitHuman;
  const deadline = Date.now() + timeBudgetMs;

  const stats: SimStats = {
    trianglesConsidered: 0,
    combosEnumerated: 0,
    stoppedEarly: false,
    trianglesSkippedNoHopOptions: 0,
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
    topErrorsByDex: {},
    errorTypeCountersByDex: {}
  };

  let loggedQuoteFailures = 0;
  let loggedTriangleComboDebug = 0;
  let hop1Total = 0;
  let hop2Total = 0;
  let hop3Total = 0;
  let optionsSamples = 0;

  const markTimeBudgetStop = () => {
    if (!stats.stoppedEarly) {
      stats.stoppedEarly = true;
      stats.stopReason = 'time budget';
    }
  };

  const isPastDeadline = () => Date.now() >= deadline;

  const allResults = await runLimited(triangles, quoteConcurrency, async (triangleEntry) => {
    if (isPastDeadline()) {
      markTimeBudgetStop();
      return [] as SimResult[];
    }
    if (stats.quoteAttempts >= maxTotalQuotes) return [] as SimResult[];
    stats.trianglesConsidered += 1;

    const triangle = triangleEntry.triangle;
    const [hop1, hop2, hop3] = triangleEntry.hopOptions;

    hop1Total += hop1.options.length;
    hop2Total += hop2.options.length;
    hop3Total += hop3.options.length;
    optionsSamples += 1;

    if (optionsSamples === 1) {
      stats.hop1OptionsMin = hop1.options.length;
      stats.hop2OptionsMin = hop2.options.length;
      stats.hop3OptionsMin = hop3.options.length;
      stats.hop1OptionsMax = hop1.options.length;
      stats.hop2OptionsMax = hop2.options.length;
      stats.hop3OptionsMax = hop3.options.length;
    } else {
      stats.hop1OptionsMin = Math.min(stats.hop1OptionsMin, hop1.options.length);
      stats.hop2OptionsMin = Math.min(stats.hop2OptionsMin, hop2.options.length);
      stats.hop3OptionsMin = Math.min(stats.hop3OptionsMin, hop3.options.length);
      stats.hop1OptionsMax = Math.max(stats.hop1OptionsMax, hop1.options.length);
      stats.hop2OptionsMax = Math.max(stats.hop2OptionsMax, hop2.options.length);
      stats.hop3OptionsMax = Math.max(stats.hop3OptionsMax, hop3.options.length);
    }

    if (!hop1.options.length || !hop2.options.length || !hop3.options.length) {
      stats.trianglesSkippedNoHopOptions += 1;
      return [] as SimResult[];
    }

    const results: SimResult[] = [];
    const theoreticalCombos = hop1.options.length * hop2.options.length * hop3.options.length;
    const cappedTheoreticalCombos = Math.min(theoreticalCombos, maxCombosPerTriangle);
    let combosEnumeratedForTriangle = 0;

    for (const o1 of hop1.options) {
      for (const o2 of hop2.options) {
        for (const o3 of hop3.options) {
          if (combosEnumeratedForTriangle >= maxCombosPerTriangle || isPastDeadline() || stats.quoteAttempts >= maxTotalQuotes) {
            if (isPastDeadline()) markTimeBudgetStop();
            if (debugHops && loggedTriangleComboDebug < 8) {
              log.info('triangle-combo-enumeration', {
                route: triangle.id,
                hopCounts: [hop1.options.length, hop2.options.length, hop3.options.length],
                theoreticalCombos,
                cappedTheoreticalCombos,
                combosEnumeratedForTriangle
              });
              loggedTriangleComboDebug += 1;
            }
            return results;
          }

          combosEnumeratedForTriangle += 1;
          stats.combosEnumerated += 1;
          const [a, b, c] = triangle.tokens;
          const hops: RouteHop[] = [
            { dex: o1.dexId, tokenIn: a, tokenOut: b, label: o1.label },
            { dex: o2.dexId, tokenIn: b, tokenOut: c, label: o2.label },
            { dex: o3.dexId, tokenIn: c, tokenOut: a, label: o3.label }
          ];

          const sim = await simulateCombo(triangle, hops, [o1, o2, o3], startAmount, gasPriceWei, ethToUsdcPrice, adapters, stats, debugHops, traceAmounts, combosEnumeratedForTriangle, deadline);
          if (debugHops && sim.failed && loggedQuoteFailures < 5) {
            log.warn('quote-failure', { triangle: triangle.id, failReason: sim.failReason, hops: hops.map((h) => h.label) });
            loggedQuoteFailures += 1;
          }
          if (!sim.failed) results.push(sim);
        }
      }
    }

    if (debugHops && loggedTriangleComboDebug < 8) {
      log.info('triangle-combo-enumeration', {
        route: triangle.id,
        hopCounts: [hop1.options.length, hop2.options.length, hop3.options.length],
        theoreticalCombos,
        cappedTheoreticalCombos,
        combosEnumeratedForTriangle
      });
      loggedTriangleComboDebug += 1;
    }

    return results;
  });

  if (optionsSamples > 0) {
    stats.hop1OptionsAvg = hop1Total / optionsSamples;
    stats.hop2OptionsAvg = hop2Total / optionsSamples;
    stats.hop3OptionsAvg = hop3Total / optionsSamples;
  }

  return { results: allResults.flat(), stats };
};

const simulateCombo = async (
  triangle: RouteCandidate,
  hops: RouteHop[],
  options: HopOption[],
  startAmount: bigint,
  gasPriceWei: bigint,
  ethToUsdcPrice: number,
  adapters: DexAdapters,
  stats: SimStats,
  debugHops: boolean,
  traceAmounts: boolean,
  comboAttemptForTriangle: number,
  deadline: number
): Promise<SimResult> => {
  let amount = startAmount;
  let gasUnits = 0n;
  let gasKnown = ethToUsdcPrice > 0;

  for (let i = 0; i < options.length; i += 1) {
    const option = options[i];
    const hop = hops[i];

    if (Date.now() >= deadline) {
      stats.stoppedEarly = true;
      stats.stopReason = 'time budget';
      return {
        route: triangle,
        hops,
        startAmount,
        finalAmount: amount,
        grossProfit: 0n,
        gasCostUsdc: 0n,
        gasKnown: false,
        netProfit: 0n,
        failed: true,
        failReason: 'time budget'
      };
    }

    stats.quoteAttempts += 1;

    let quote: Awaited<ReturnType<HopOption['quote']>>;
    try {
      quote = await option.quote(amount);
    } catch (error) {
      const hopKey = `hop${i + 1}:${hop.tokenIn.symbol}->${hop.tokenOut.symbol}`;
      const rawErrMsg = error instanceof Error ? error.message : String(error);
      const errMsg = rawErrMsg && rawErrMsg.trim().length > 0 ? rawErrMsg : 'unknown quote error';
      if (traceAmounts && comboAttemptForTriangle <= 10) {
        log.warn('hop-fail', {
          triangle: triangle.id,
          comboAttemptForTriangle,
          hop: i + 1,
          pair: `${hop.tokenIn.symbol}->${hop.tokenOut.symbol}`,
          dex: option.dexId,
          amountIn: amount.toString(),
          err: errMsg
        });
      }
      markError(stats, option.dexId, hopKey, `THROW: ${errMsg}`.slice(0, 180), debugHops);
      return {
        route: triangle,
        hops,
        startAmount,
        finalAmount: amount,
        grossProfit: 0n,
        gasCostUsdc: 0n,
        gasKnown: false,
        netProfit: 0n,
        failed: true,
        failReason: `${option.dexId} THROW: ${errMsg}`
      };
    }

    if (!quote || quote.amountOut <= 0n) {
      const hopKey = `hop${i + 1}:${hop.tokenIn.symbol}->${hop.tokenOut.symbol}`;
      const summary = getLastDexError(adapters, option.dexId, debugHops);
      if (traceAmounts && comboAttemptForTriangle <= 10) {
        log.warn('hop-fail', {
          triangle: triangle.id,
          comboAttemptForTriangle,
          hop: i + 1,
          pair: `${hop.tokenIn.symbol}->${hop.tokenOut.symbol}`,
          dex: option.dexId,
          amountIn: amount.toString(),
          err: summary
        });
      }
      markError(stats, option.dexId, hopKey, summary, debugHops);
      return {
        route: triangle,
        hops,
        startAmount,
        finalAmount: amount,
        grossProfit: 0n,
        gasCostUsdc: 0n,
        gasKnown: false,
        netProfit: 0n,
        failed: true,
        failReason: `${option.dexId} ${summary}`
      };
    }

    if (option.dexId === 'aerodrome' && quote.meta?.routeHops === 2 && typeof quote.meta.via === 'string') {
      hop.label = `${hop.label}/via ${quote.meta.via}`;
    }

    if (traceAmounts && comboAttemptForTriangle <= 10) {
      log.info('hop-trace', {
        triangle: triangle.id,
        comboAttemptForTriangle,
        hop: i + 1,
        pair: `${hop.tokenIn.symbol}->${hop.tokenOut.symbol}`,
        dex: option.dexId,
        amountIn: amount.toString(),
        amountOut: quote.amountOut.toString()
      });
    }

    amount = quote.amountOut;
    if (quote.gasUnitsEstimate === undefined) {
      gasKnown = false;
    } else {
      gasUnits += quote.gasUnitsEstimate;
    }
  }

  const gross = amount - startAmount;
  const gasWei = gasUnits * gasPriceWei;
  const gasUsdc = gasKnown
    ? (gasWei * BigInt(Math.round(ethToUsdcPrice * 1_000_000))) / 1_000_000_000_000_000_000n
    : 0n;

  return {
    route: triangle,
    hops,
    startAmount,
    finalAmount: amount,
    grossProfit: gross,
    gasCostUsdc: gasUsdc,
    gasKnown,
    netProfit: gasKnown ? gross - gasUsdc : gross,
    failed: false
  };
};

export const deriveEthToUsdcPrice = async (adapters: DexAdapters, usdc: Token, weth: Token): Promise<number> => {
  const amountIn = 10n ** 18n;
  if (adapters.uniswapv3) {
    for (const fee of adapters.uniswapv3.feeTiers) {
      const q = await adapters.uniswapv3.quoteWithFee(weth, usdc, amountIn, fee);
      if (q && q.amountOut > 0n) return fromUnits(q.amountOut, usdc.decimals);
    }
  }
  if (adapters.aerodrome) {
    const qVol = await adapters.aerodrome.quoteExactIn({ tokenIn: weth, tokenOut: usdc, amountIn }, 'deriveEthToUsdcPrice');
    if (qVol && qVol.amountOut > 0n) return fromUnits(qVol.amountOut, usdc.decimals);
    if (adapters.aerodrome.canUseStable(weth, usdc)) {
      const qStable = await adapters.aerodrome.quoteByMode(weth, usdc, amountIn, true);
      if (qStable && qStable.amountOut > 0n) return fromUnits(qStable.amountOut, usdc.decimals);
    }
  }
  return 0;
};
