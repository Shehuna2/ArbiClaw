import { fromUnits, toUnits } from '../core/math.js';
import { RouteHop, SimResult, SimStats, Token, RouteCandidate } from '../core/types.js';
import { DexAdapters, HopOption, buildHopOptions } from './hopOptions.js';
import { runLimited } from '../utils/concurrency.js';

interface SimulateParams {
  adapters: DexAdapters;
  triangles: RouteCandidate[];
  startToken: Token;
  amountInHuman: number;
  minProfitHuman: number;
  gasPriceWei: bigint;
  ethToUsdcPrice: number;
  maxCombosPerTriangle: number;
  maxTotalQuotes: number;
  timeBudgetMs: number;
  quoteConcurrency: number;
}

interface SimulateOutput {
  results: SimResult[];
  stats: SimStats;
}

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
    quoteConcurrency
  } = params;

  const startAmount = toUnits(amountInHuman, startToken.decimals);
  const minProfit = toUnits(minProfitHuman, startToken.decimals);
  const deadline = Date.now() + timeBudgetMs;

  const stats: SimStats = {
    trianglesConsidered: 0,
    combosEnumerated: 0,
    quoteErrorsOrSkips: 0,
    quotesAttempted: 0
  };

  const allResults = await runLimited(triangles, quoteConcurrency, async (triangle) => {
    if (Date.now() > deadline || stats.quotesAttempted >= maxTotalQuotes) return [] as SimResult[];

    stats.trianglesConsidered += 1;
    const [a, b, c] = triangle.tokens;

    const [hop1, hop2, hop3] = await Promise.all([
      buildHopOptions(a, b, adapters),
      buildHopOptions(b, c, adapters),
      buildHopOptions(c, a, adapters)
    ]);

    if (!hop1.length || !hop2.length || !hop3.length) {
      stats.quoteErrorsOrSkips += 1;
      return [] as SimResult[];
    }

    const results: SimResult[] = [];

    for (const o1 of hop1) {
      for (const o2 of hop2) {
        for (const o3 of hop3) {
          if (results.length >= maxCombosPerTriangle || Date.now() > deadline || stats.quotesAttempted >= maxTotalQuotes) {
            return results;
          }

          stats.combosEnumerated += 1;
          const hops: RouteHop[] = [
            { dex: o1.dexId, tokenIn: a, tokenOut: b, label: o1.label },
            { dex: o2.dexId, tokenIn: b, tokenOut: c, label: o2.label },
            { dex: o3.dexId, tokenIn: c, tokenOut: a, label: o3.label }
          ];

          const sim = await simulateCombo(triangle, hops, [o1, o2, o3], startAmount, gasPriceWei, ethToUsdcPrice);
          stats.quotesAttempted += 3;
          if (sim.failed) stats.quoteErrorsOrSkips += 1;
          if (!sim.failed && sim.netProfit >= minProfit) results.push(sim);
        }
      }
    }

    return results;
  });

  return { results: allResults.flat(), stats };
};

const simulateCombo = async (
  triangle: RouteCandidate,
  hops: RouteHop[],
  options: HopOption[],
  startAmount: bigint,
  gasPriceWei: bigint,
  ethToUsdcPrice: number
): Promise<SimResult> => {
  let amount = startAmount;
  let gasUnits = 0n;

  for (const option of options) {
    const quote = await option.quote(amount);
    if (!quote || quote.amountOut <= 0n) {
      return {
        route: triangle,
        hops,
        startAmount,
        finalAmount: amount,
        grossProfit: 0n,
        gasCostUsdc: 0n,
        netProfit: 0n,
        failed: true,
        failReason: 'missing quote'
      };
    }
    amount = quote.amountOut;
    gasUnits += quote.gasUnitsEstimate ?? 150_000n;
  }

  const gross = amount - startAmount;
  const gasWei = gasUnits * gasPriceWei;
  const gasUsdc = ethToUsdcPrice > 0
    ? toUnits((Number(gasWei) / 1e18) * ethToUsdcPrice, 6)
    : 0n;

  return {
    route: triangle,
    hops,
    startAmount,
    finalAmount: amount,
    grossProfit: gross,
    gasCostUsdc: gasUsdc,
    netProfit: gross - gasUsdc,
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
    for (const stable of [false, true]) {
      const q = await adapters.aerodrome.quoteByMode(weth, usdc, amountIn, stable);
      if (q && q.amountOut > 0n) return fromUnits(q.amountOut, usdc.decimals);
    }
  }
  return 0;
};
