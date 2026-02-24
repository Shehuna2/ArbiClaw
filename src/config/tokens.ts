import { Token } from '../core/types.js';
import { UNI_V3_ADDRESSES } from '../dex/uniswapv3/addresses.js';

export const TOKENS = {
  USDC: { symbol: 'USDC', address: UNI_V3_ADDRESSES.USDC, decimals: 6 },
  WETH: { symbol: 'WETH', address: UNI_V3_ADDRESSES.WETH, decimals: 18 }
} as const satisfies Record<string, Token>;

export const START_TOKEN = TOKENS.USDC;

export const TRIANGLE_TOKENS: Token[] = [TOKENS.WETH];
