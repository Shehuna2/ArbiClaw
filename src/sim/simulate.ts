import { RouteCandidate, SimResult, Token } from '../core/types.js';
import { toUnits } from '../core/math.js';
import { DexQuoter } from '../dex/DexQuoter.js';
import { runLimited } from '../utils/concurrency.js';

interface SimulateParams {
  dexQuoters: Map<string, DexQuoter>;
  routes: RouteCandidate[];
  startToken: Token;
  amountInHuman: number;
  minProfitHuman: number;
  gasPriceWei: bigint;
  ethToUsdcPrice: number;
}

export const simulateRoutes = async (params: SimulateParams): Promise<SimResult[]> => {
  const { dexQuoters, routes, startToken, amountInHuman, minProfitHuman, gasPriceWei, ethToUsdcPrice } = params;
  const startAmount = toUnits(amountInHuman, startToken.decimals);
  const minProfit = toUnits(minProfitHuman, startToken.decimals);

  return runLimited(routes, 8, async (route) => {
    let amount = startAmount;
    let gasUnits = 0n;

    try {
      for (const hop of route.hops) {
        const quoter = dexQuoters.get(hop.dex);
        if (!quoter) throw new Error(`Missing quoter for dex=${hop.dex}`);
        const quote = await quoter.quoteExactIn({ tokenIn: hop.tokenIn, tokenOut: hop.tokenOut, amountIn: amount });
        if (!quote) throw new Error(`No quote (${hop.dex}:${hop.tokenIn.symbol}->${hop.tokenOut.symbol})`);
        amount = quote.amountOut;
        gasUnits += quote.gasUnitsEstimate ?? 150_000n;
      }

      const gross = amount - startAmount;
      const gasWei = gasUnits * gasPriceWei;
      const gasUsdc = ethToUsdcPrice > 0
        ? toUnits((Number(gasWei) / 1e18) * ethToUsdcPrice, startToken.decimals)
        : 0n;
      const net = gross - gasUsdc;

      return {
        route,
        startAmount,
        finalAmount: amount,
        grossProfit: gross,
        gasCostUsdc: gasUsdc,
        netProfit: net,
        failed: net < minProfit
      };
    } catch (error) {
      return {
        route,
        startAmount,
        finalAmount: amount,
        grossProfit: 0n,
        gasCostUsdc: 0n,
        netProfit: 0n,
        failed: true,
        failReason: error instanceof Error ? error.message : 'Unknown route failure'
      };
    }
  });
};
