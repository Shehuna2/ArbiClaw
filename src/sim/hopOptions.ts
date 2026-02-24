import { Token } from '../core/types.js';
import { AerodromeQuoter } from '../dex/aerodrome/AerodromeQuoter.js';
import { UniswapV3Quoter } from '../dex/uniswapv3/UniswapV3Quoter.js';

export interface HopQuoteResult {
  amountOut: bigint;
  gasUnitsEstimate?: bigint;
}

export interface HopOption {
  dexId: string;
  label: string;
  quote: (amountIn: bigint) => Promise<HopQuoteResult | null>;
}

export interface DexAdapters {
  uniswapv3?: UniswapV3Quoter;
  aerodrome?: AerodromeQuoter;
}

export const buildHopOptions = async (
  tokenIn: Token,
  tokenOut: Token,
  adapters: DexAdapters
): Promise<HopOption[]> => {
  const options: HopOption[] = [];

  if (adapters.uniswapv3) {
    for (const fee of adapters.uniswapv3.feeTiers) {
      try {
        const hasPool = await adapters.uniswapv3.hasPool(tokenIn, tokenOut, fee);
        if (!hasPool) continue;
        options.push({
          dexId: 'uniswapv3',
          label: `UNI:${fee}`,
          quote: async (amountIn: bigint) => {
            const result = await adapters.uniswapv3?.quoteWithFee(tokenIn, tokenOut, amountIn, fee);
            return result ? { amountOut: result.amountOut, gasUnitsEstimate: result.gasUnitsEstimate } : null;
          }
        });
      } catch {
        continue;
      }
    }
  }

  if (adapters.aerodrome) {
    for (const stable of [false, true]) {
      options.push({
        dexId: 'aerodrome',
        label: `AERO:${stable ? 'stable' : 'vol'}`,
        quote: async (amountIn: bigint) => {
          const result = await adapters.aerodrome?.quoteByMode(tokenIn, tokenOut, amountIn, stable);
          return result ? { amountOut: result.amountOut, gasUnitsEstimate: result.gasUnitsEstimate } : null;
        }
      });
    }
  }

  return options;
};
