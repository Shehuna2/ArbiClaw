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

const isAeroPair = (tokenIn: Token, tokenOut: Token): boolean => tokenIn.symbol === 'AERO' || tokenOut.symbol === 'AERO';

export const buildHopOptions = async ({ tokenIn, tokenOut, adapters, feePrefs }: HopBuildParams): Promise<HopOptionsBuild> => {
  const uniOptions: HopOption[] = [];
  const aeroOptions: HopOption[] = [];
  const uniPoolChecks: UniPoolCheck[] = [];

  if (adapters.uniswapv3) {
    const feeOrder = getPairFeeOrder(tokenIn.symbol, tokenOut.symbol, adapters.uniswapv3.feeTiers, feePrefs);
    for (const fee of feeOrder) {
      try {
        const poolAddress = await adapters.uniswapv3.getPoolAddress(tokenIn, tokenOut, fee);
        const poolExists = await adapters.uniswapv3.hasPool(tokenIn, tokenOut, fee);
        uniPoolChecks.push({ fee, poolAddress, hasPool: poolExists });
        if (!poolExists) continue;

        uniOptions.push({
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
    aeroOptions.push({
      dexId: 'aerodrome',
      label: 'AERO:vol',
      quote: async (amountIn: bigint) => {
        const result = await adapters.aerodrome?.quoteByMode(tokenIn, tokenOut, amountIn, false);
        return result ? { amountOut: result.amountOut, gasUnitsEstimate: result.gasUnitsEstimate } : null;
      }
    });

    if (adapters.aerodrome.canUseStable(tokenIn, tokenOut)) {
      aeroOptions.push({
        dexId: 'aerodrome',
        label: 'AERO:stable',
        quote: async (amountIn: bigint) => {
          const result = await adapters.aerodrome?.quoteByMode(tokenIn, tokenOut, amountIn, true);
          return result ? { amountOut: result.amountOut, gasUnitsEstimate: result.gasUnitsEstimate } : null;
        }
      });
    }
  }

  const options = isAeroPair(tokenIn, tokenOut) ? [...aeroOptions, ...uniOptions] : [...uniOptions, ...aeroOptions];

  return {
    options,
    debug: {
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      uniPoolChecks
    }
  };
};
