import { DexQuoter, SingleHopQuoteParams, SingleHopQuoteResult } from '../dex.js';
import { createUniV3Client } from './client.js';

export class UniswapV3Quoter implements DexQuoter {
  public readonly name = 'uniswap-v3';
  private readonly client;

  constructor(rpcUrl: string) {
    this.client = createUniV3Client(rpcUrl);
  }

  async hasPool(tokenIn: string, tokenOut: string, fee: number): Promise<boolean> {
    const pool = await this.client.factory.getPool(tokenIn, tokenOut, fee);
    return pool !== '0x0000000000000000000000000000000000000000';
  }

  async quoteExactInSingle(params: SingleHopQuoteParams): Promise<SingleHopQuoteResult> {
    const { tokenIn, tokenOut, fee, amountIn } = params;
    const [amountOut, , , gasEstimate] = await this.client.quoterV2.quoteExactInputSingle.staticCall({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee,
      amountIn,
      sqrtPriceLimitX96: 0
    });

    return { amountOut, gasEstimate };
  }

  async getGasPriceWei(): Promise<bigint> {
    const feeData = await this.client.provider.getFeeData();
    return feeData.gasPrice ?? feeData.maxFeePerGas ?? 1_000_000_000n;
  }
}
