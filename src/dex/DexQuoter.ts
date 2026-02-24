import { Token } from '../core/types.js';

export interface QuoteParams {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
}

export interface QuoteResult {
  amountOut: bigint;
  gasUnitsEstimate?: bigint;
  meta: Record<string, unknown>;
}

export interface DexQuoter {
  id: string;
  quoteExactIn(params: QuoteParams): Promise<QuoteResult | null>;
}
