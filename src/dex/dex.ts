import { Token } from '../core/types.js';

export interface SingleHopQuoteParams {
  tokenIn: Token;
  tokenOut: Token;
  fee: number;
  amountIn: bigint;
}

export interface SingleHopQuoteResult {
  amountOut: bigint;
  gasEstimate?: bigint;
}

export interface DexQuoter {
  readonly name: string;
  quoteExactInSingle(params: SingleHopQuoteParams): Promise<SingleHopQuoteResult>;
}
