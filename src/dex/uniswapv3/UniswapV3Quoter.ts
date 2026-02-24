import { QuoteResult } from '../DexQuoter.js';
import { Token } from '../../core/types.js';
import { createUniV3Client } from './client.js';
import { bindUniV3Factory, getPoolAddress, hasPool } from './pools.js';

const summarizeErr = (error: unknown): string => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : 'ERR';
  const msg = error instanceof Error ? error.message : String(error);
  return `${code}: ${msg}`.slice(0, 180);
};

export class UniswapV3Quoter {
  public readonly id = 'uniswapv3';
  private readonly client;
  private lastError = '';

  constructor(rpcUrl: string, public readonly feeTiers: number[]) {
    this.client = createUniV3Client(rpcUrl);
    bindUniV3Factory(this.client.factory);
  }

  getLastError(): string {
    return this.lastError;
  }

  async getPoolAddress(tokenIn: Token, tokenOut: Token, fee: number): Promise<string> {
    return getPoolAddress(tokenIn.address, tokenOut.address, fee);
  }

  async hasPool(tokenIn: Token, tokenOut: Token, fee: number): Promise<boolean> {
    return hasPool(tokenIn.address, tokenOut.address, fee);
  }

  async quoteWithFee(tokenIn: Token, tokenOut: Token, amountIn: bigint, fee: number): Promise<QuoteResult | null> {
    try {
      const fn = this.client.quoterV2.getFunction('quoteExactInputSingle');
      const [amountOut, , , gasEstimate] = await fn.staticCall({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0
      });
      this.lastError = '';
      return { amountOut, gasUnitsEstimate: gasEstimate, meta: { feeTier: fee } };
    } catch (error) {
      this.lastError = summarizeErr(error);
      return null;
    }
  }
}
