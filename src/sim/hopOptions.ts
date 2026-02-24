import { FeePrefs, getPairFeeOrder } from '../config/fees.js';
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

export interface UniPoolCheck {
  fee: number;
  poolAddress: string;
  hasPool: boolean;
}

export interface HopOptionsBuild {
  options: HopOption[];
  debug: {
    tokenIn: string;
    tokenOut: string;
    uniPoolChecks: UniPoolCheck[];
  };
}

interface HopBuildParams {
  tokenIn: Token;
  tokenOut: Token;
  adapters: DexAdapters;
  feePrefs: FeePrefs;
}

export const buildHopOptions = async ({ tokenIn, tokenOut, adapters, feePrefs }: HopBuildParams): Promise<HopOptionsBuild> => {
  const options: HopOption[] = [];
  const uniPoolChecks: UniPoolCheck[] = [];

  if (adapters.uniswapv3) {
    const feeOrder = getPairFeeOrder(tokenIn.symbol, tokenOut.symbol, adapters.uniswapv3.feeTiers, feePrefs);
    for (const fee of feeOrder) {
      try {
        const poolAddress = await adapters.uniswapv3.getPoolAddress(tokenIn, tokenOut, fee);
        const poolExists = await adapters.uniswapv3.hasPool(tokenIn, tokenOut, fee);
        uniPoolChecks.push({ fee, poolAddress, hasPool: poolExists });
        if (!poolExists) continue;

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

  return {
    options,
    debug: {
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      uniPoolChecks
    }
  };
};
