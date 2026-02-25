import { FeePrefs, getPairFeeOrder } from '../config/fees.js';
import { Token } from '../core/types.js';
import { AerodromeQuoter } from '../dex/aerodrome/AerodromeQuoter.js';
import { UniswapV3Quoter } from '../dex/uniswapv3/UniswapV3Quoter.js';

export interface HopQuoteResult {
  amountOut: bigint;
  gasUnitsEstimate?: bigint;
  meta?: Record<string, unknown>;
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
    optionLabels: string[];
    dexCounts: Record<string, number>;
  };
}

interface HopBuildParams {
  tokenIn: Token;
  tokenOut: Token;
  adapters: DexAdapters;
  feePrefs: FeePrefs;
}

const isAeroPair = (tokenIn: Token, tokenOut: Token): boolean => tokenIn.symbol === 'AERO' || tokenOut.symbol === 'AERO';

const shouldPreferUniFirst = (tokenIn: Token, tokenOut: Token): boolean => {
  if (tokenOut.symbol === 'USDC') return true;
  const isUsdcWethPair = (tokenIn.symbol === 'USDC' && tokenOut.symbol === 'WETH') || (tokenIn.symbol === 'WETH' && tokenOut.symbol === 'USDC');
  if (isUsdcWethPair) return true;
  return false;
};

const orderHopOptions = (tokenIn: Token, tokenOut: Token, uniOptions: HopOption[], aeroOptions: HopOption[]): HopOption[] => {
  if (shouldPreferUniFirst(tokenIn, tokenOut)) return [...uniOptions, ...aeroOptions];
  if (isAeroPair(tokenIn, tokenOut)) return [...aeroOptions, ...uniOptions];
  return [...uniOptions, ...aeroOptions];
};

export const buildHopOptions = async ({ tokenIn, tokenOut, adapters, feePrefs }: HopBuildParams): Promise<HopOptionsBuild> => {
  const uniOptions: HopOption[] = [];
  const aeroOptions: HopOption[] = [];
  const uniPoolChecks: UniPoolCheck[] = [];

  // Build pure runtime quote options; do not precompute quote outputs here.
  if (adapters.uniswapv3) {
    const feeOrder = getPairFeeOrder(tokenIn.symbol, tokenOut.symbol, adapters.uniswapv3.feeTiers, feePrefs);
    for (const fee of feeOrder) {
      let poolAddress = 'unknown';
      try {
        const poolExists = await adapters.uniswapv3.hasPool(tokenIn, tokenOut, fee);
        try {
          poolAddress = await adapters.uniswapv3.getPoolAddress(tokenIn, tokenOut, fee);
        } catch {
          poolAddress = 'unknown';
        }
        uniPoolChecks.push({ fee, poolAddress, hasPool: poolExists });
        if (!poolExists) continue;

        uniOptions.push({
          dexId: 'uniswapv3',
          label: `UNI:${fee}`,
          quote: async (amountIn: bigint) => {
            const result = await adapters.uniswapv3?.quoteWithFee(tokenIn, tokenOut, amountIn, fee);
            return result ? { amountOut: result.amountOut, gasUnitsEstimate: result.gasUnitsEstimate, meta: result.meta } : null;
          }
        });
      } catch {
        uniPoolChecks.push({ fee, poolAddress, hasPool: false });
        continue;
      }
    }
  }

  if (adapters.aerodrome) {
    aeroOptions.push({
      dexId: 'aerodrome',
      label: 'AERO:vol',
      quote: async (amountIn: bigint) => {
        const result = await adapters.aerodrome?.quoteExactIn({ tokenIn, tokenOut, amountIn }, 'hopOptions');
        return result ? { amountOut: result.amountOut, gasUnitsEstimate: result.gasUnitsEstimate, meta: result.meta } : null;
      }
    });

    if (adapters.aerodrome.canUseStable(tokenIn, tokenOut)) {
      aeroOptions.push({
        dexId: 'aerodrome',
        label: 'AERO:stable',
        quote: async (amountIn: bigint) => {
          const result = await adapters.aerodrome?.quoteByMode(tokenIn, tokenOut, amountIn, true);
          return result ? { amountOut: result.amountOut, gasUnitsEstimate: result.gasUnitsEstimate, meta: result.meta } : null;
        }
      });
    }
  }

  const options = orderHopOptions(tokenIn, tokenOut, uniOptions, aeroOptions);
  const dexCounts = options.reduce<Record<string, number>>((acc, option) => {
    acc[option.dexId] = (acc[option.dexId] ?? 0) + 1;
    return acc;
  }, {});

  return {
    options,
    debug: {
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      uniPoolChecks,
      optionLabels: options.map((option) => option.label),
      dexCounts
    }
  };
};
