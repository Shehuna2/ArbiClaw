import { Contract, JsonRpcProvider } from 'ethers';
import { StableConfig, isStableEligiblePair } from '../../config/stables.js';
import { QuoteParams, QuoteResult } from '../DexQuoter.js';
import { Token } from '../../core/types.js';
import { log } from '../../core/log.js';

const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from,address to,bool stable,address factory)[] routes) view returns (uint256[] amounts)'
];
const GET_AMOUNTS_OUT_FN = 'getAmountsOut(uint256,(address,address,bool,address)[])';

type AeroRoute = [string, string, boolean, string];

interface CachedQuote {
  expiryMs: number;
  result: QuoteResult | null;
}

const summarizeErr = (error: unknown): string => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : 'ERR';
  const msg = error instanceof Error ? error.message : String(error);
  return `${code}: ${msg}`.slice(0, 180);
};

const shouldLogRoute = (): boolean => process.argv.includes('--debugHops') || process.argv.includes('--traceAmounts');

export class AerodromeQuoter {
  public readonly id = 'aerodrome';
  private readonly router: Contract;
  private readonly cache = new Map<string, CachedQuote>();
  private readonly ttlMs = 8_000;
  private lastError = '';
  private selectorLogged = false;

  constructor(rpcUrl: string, private readonly stableConfig: StableConfig) {
    const provider = new JsonRpcProvider(rpcUrl);
    this.router = new Contract(AERODROME_ROUTER, ROUTER_ABI, provider);

    const selector = this.router.interface.getFunction(GET_AMOUNTS_OUT_FN)?.selector ?? 'unknown';
    if (selector !== '0x5509a1ac') {
      throw new Error(`Aerodrome ABI mismatch: expected selector 0x5509a1ac, got ${selector}`);
    }
  }

  getLastError(includeSelector = false): string {
    if (!includeSelector) return this.lastError;
    const selector = this.router.interface.getFunction(GET_AMOUNTS_OUT_FN)?.selector ?? 'unknown';
    return `[selector:${selector}] ${this.lastError}`.trim();
  }

  canUseStable(tokenIn: Token, tokenOut: Token): boolean {
    return isStableEligiblePair(tokenIn, tokenOut, this.stableConfig);
  }

  private maybeLogSelectorInvariant(): void {
    if (this.selectorLogged) return;
    if (!process.argv.includes('--debugHops') && !process.argv.includes('--selfTest')) return;

    const selector = this.router.interface.getFunction(GET_AMOUNTS_OUT_FN)?.selector ?? 'unknown';
    if (selector !== '0x5509a1ac') {
      throw new Error(`Aerodrome selector mismatch: expected 0x5509a1ac, got ${selector}`);
    }
    log.info('aerodrome-selector', { selector, expectedSelector: '0x5509a1ac' });
    this.selectorLogged = true;
  }

  encodeGetAmountsOutCalldata(tokenIn: string, tokenOut: string, amountIn: bigint, stable: boolean): string {
    const routes: AeroRoute[] = [[tokenIn, tokenOut, stable, AERODROME_FACTORY]];
    return this.router.interface.encodeFunctionData(GET_AMOUNTS_OUT_FN, [amountIn, routes]);
  }

  private async quoteRoutes(amountIn: bigint, routes: AeroRoute[]): Promise<bigint | null> {
    const amounts: bigint[] = await this.router.getFunction(GET_AMOUNTS_OUT_FN).staticCall(amountIn, routes);
    const amountOut = amounts[amounts.length - 1];
    return amountOut > 0n ? amountOut : null;
  }

  async quoteExactIn(params: QuoteParams, callsite = 'unknown'): Promise<QuoteResult | null> {
    if (process.argv.includes('--debugHops')) {
      const selector = this.router.interface.getFunction(GET_AMOUNTS_OUT_FN)?.selector ?? 'unknown';
      const routes: AeroRoute[] = [[params.tokenIn.address, params.tokenOut.address, false, AERODROME_FACTORY]];
      const calldata = this.router.interface.encodeFunctionData(GET_AMOUNTS_OUT_FN, [params.amountIn, routes]);
      const calldataSelector = calldata.slice(0, 10);
      if (calldataSelector !== '0x5509a1ac') {
        throw new Error(`Aerodrome selector drift detected: ${calldataSelector} callsite=${callsite}`);
      }
      log.info('aerodrome-quoteexactin-calldata', {
        callsite,
        selector,
        first10Bytes: calldata.slice(0, 22)
      });
    }

    return this.quoteByMode(params.tokenIn, params.tokenOut, params.amountIn, false);
  }

  async quotePreferred(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<QuoteResult | null> {
    const qVol = await this.quoteExactIn({ tokenIn, tokenOut, amountIn }, 'quotePreferred');
    if (qVol) return qVol;
    if (!this.canUseStable(tokenIn, tokenOut)) {
      this.lastError = 'STABLE_SKIPPED: pair not stable-eligible';
      return null;
    }
    return this.quoteByMode(tokenIn, tokenOut, amountIn, true);
  }

  async quoteByMode(tokenIn: Token, tokenOut: Token, amountIn: bigint, stable: boolean): Promise<QuoteResult | null> {
    this.maybeLogSelectorInvariant();
    if (stable && !this.canUseStable(tokenIn, tokenOut)) {
      this.lastError = 'STABLE_SKIPPED: pair not stable-eligible';
      return null;
    }

    const key = `${tokenIn.address}:${tokenOut.address}:${amountIn.toString()}:${stable ? 's' : 'v'}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiryMs > now) return hit.result;

    if (!stable) {
      const candidates: Array<{ hops: number; via?: string; routes: AeroRoute[] }> = [
        { hops: 1, routes: [[tokenIn.address, tokenOut.address, false, AERODROME_FACTORY]] }
      ];

      const weth = WETH_BASE;
      const tokenInIsWeth = tokenIn.address.toLowerCase() === weth.toLowerCase();
      const tokenOutIsWeth = tokenOut.address.toLowerCase() === weth.toLowerCase();
      if (!tokenInIsWeth && !tokenOutIsWeth) {
        if (tokenOut.symbol === 'USDC') {
          candidates.push({
            hops: 2,
            via: 'WETH',
            routes: [
              [tokenIn.address, weth, false, AERODROME_FACTORY],
              [weth, tokenOut.address, false, AERODROME_FACTORY]
            ]
          });
        }
      }

      let best: QuoteResult | null = null;
      let bestMeta: { hops: number; via?: string } = { hops: 1 };
      const failures: string[] = [];
      for (const candidate of candidates) {
        try {
          const out = await this.quoteRoutes(amountIn, candidate.routes);
          if (!out) {
            failures.push(`routerQuote: ZERO_OUT hops=${candidate.hops}${candidate.via ? ` via=${candidate.via}` : ''}`);
            continue;
          }
          if (!best || out > best.amountOut) {
            best = { amountOut: out, gasUnitsEstimate: undefined, meta: { stable: false, routeHops: candidate.hops, via: candidate.via } };
            bestMeta = { hops: candidate.hops, via: candidate.via };
          }
        } catch (error) {
          failures.push(`routerQuote: ${summarizeErr(error)} hops=${candidate.hops}${candidate.via ? ` via=${candidate.via}` : ''}`);
        }
      }

      if (best) {
        this.cache.set(key, { expiryMs: now + this.ttlMs, result: best });
        this.lastError = '';
        if (shouldLogRoute()) {
          log.info('aero-route-chosen', {
            pair: `${tokenIn.symbol}->${tokenOut.symbol}`,
            hops: bestMeta.hops,
            via: bestMeta.via ?? null
          });
        }
        return best;
      }

      this.lastError = failures[0] ?? 'routerQuote: no successful volatile route';
      this.cache.set(key, { expiryMs: now + this.ttlMs, result: null });
      return null;
    }

    try {
      const routes: AeroRoute[] = [[tokenIn.address, tokenOut.address, true, AERODROME_FACTORY]];
      const amountOut = await this.quoteRoutes(amountIn, routes);
      const result = amountOut ? { amountOut, gasUnitsEstimate: undefined, meta: { stable: true, routeHops: 1 } } : null;
      this.cache.set(key, { expiryMs: now + this.ttlMs, result });
      this.lastError = result ? '' : 'ZERO_OUT: routerQuote returned zero amount';
      return result;
    } catch (error) {
      const summary = summarizeErr(error);
      this.lastError = `routerQuote STABLE_REVERT_EXPECTED: ${summary}`;
      this.cache.set(key, { expiryMs: now + this.ttlMs, result: null });
      return null;
    }
  }
}
