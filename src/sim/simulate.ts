import { Token, RouteCandidate, SimResult } from '../core/types.js';
import { fromUnits, toUnits } from '../core/math.js';
import { log } from '../core/log.js';
import { UniswapV3Quoter } from '../dex/uniswapv3/quoter.js';
import { runLimited } from '../utils/concurrency.js';

interface SimulateParams {
  quoter: UniswapV3Quoter;
  routes: RouteCandidate[];
  startToken: Token;
  amountInHuman: number;
  minProfitHuman: number;
}

export const simulateRoutes = async (params: SimulateParams): Promise<SimResult[]> => {
  const { quoter, routes, startToken, amountInHuman, minProfitHuman } = params;
  if (!routes.length) return [];

  const startAmount = toUnits(amountInHuman, startToken.decimals);
  const minProfit = toUnits(minProfitHuman, startToken.decimals);
  const gasPriceWei = await quoter.getGasPriceWei();

  let ethToUsdcPrice = 0;
  try {
    const gasRefToken = routes[0].hops[0].tokenOut;
    const oneEthOut = await quoter.quoteExactInSingle({
      tokenIn: gasRefToken,
      tokenOut: startToken,
      fee: 3000,
      amountIn: 10n ** 18n
    });
    ethToUsdcPrice = fromUnits(oneEthOut.amountOut, startToken.decimals);
  } catch {
    log.warn('Could not derive gas reference price for conversion. Using zero gas USDC cost.');
  }

  const results = await runLimited(routes, 8, async (route) => {
    let amount = startAmount;
    let gasUnits = 0n;

    try {
      for (const hop of route.hops) {
        if (!(await quoter.hasPool(hop.tokenIn.address, hop.tokenOut.address, hop.fee))) {
          throw new Error(`Pool missing (${hop.tokenIn.symbol}/${hop.tokenOut.symbol} ${hop.fee})`);
        }

        const quote = await quoter.quoteExactInSingle({
          tokenIn: hop.tokenIn,
          tokenOut: hop.tokenOut,
          fee: hop.fee,
          amountIn: amount
        });
        amount = quote.amountOut;
        gasUnits += quote.gasEstimate ?? 150_000n;
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

  return results;
};
