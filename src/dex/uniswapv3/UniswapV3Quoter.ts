import { QuoteResult } from '../DexQuoter.js';
import { Token } from '../../core/types.js';
import { createUniV3Client } from './client.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class UniswapV3Quoter {
  public readonly id = 'uniswapv3';
  private readonly client;

  constructor(rpcUrl: string, public readonly feeTiers: number[]) {
    this.client = createUniV3Client(rpcUrl);
  }

  async hasPool(tokenIn: Token, tokenOut: Token, fee: number): Promise<boolean> {
    const pool = await this.client.factory.getPool(tokenIn.address, tokenOut.address, fee);
    return pool !== ZERO_ADDRESS;
  }

  async quoteWithFee(tokenIn: Token, tokenOut: Token, amountIn: bigint, fee: number): Promise<QuoteResult | null> {
    try {
      const [amountOut, , , gasEstimate] = await this.client.quoterV2.quoteExactInputSingle.staticCall({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        fee,
        amountIn,
        sqrtPriceLimitX96: 0
      });
      return { amountOut, gasUnitsEstimate: gasEstimate, meta: { feeTier: fee } };
    } catch {
      return null;
    }
  }
}
