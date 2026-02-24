import { DexQuoter, QuoteParams, QuoteResult } from '../DexQuoter.js';
import { createUniV3Client } from './client.js';

export class UniswapV3Quoter implements DexQuoter {
  public readonly id = 'uniswapv3';
  private readonly client;

  constructor(rpcUrl: string, private readonly feeTiers: number[]) {
    this.client = createUniV3Client(rpcUrl);
  }

  async quoteExactIn(params: QuoteParams): Promise<QuoteResult | null> {
    const { tokenIn, tokenOut, amountIn } = params;
    let best: QuoteResult | null = null;

    for (const fee of this.feeTiers) {
      try {
        const pool = await this.client.factory.getPool(tokenIn.address, tokenOut.address, fee);
        if (pool === '0x0000000000000000000000000000000000000000') continue;

        const [amountOut, , , gasEstimate] = await this.client.quoterV2.quoteExactInputSingle.staticCall({
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          fee,
          amountIn,
          sqrtPriceLimitX96: 0
        });

        if (!best || amountOut > best.amountOut) {
          best = { amountOut, gasUnitsEstimate: gasEstimate, meta: { feeTier: fee, pool } };
        }
      } catch {
        continue;
      }
    }

    return best;
  }
}
