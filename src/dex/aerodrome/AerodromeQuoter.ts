import { Contract, JsonRpcProvider } from 'ethers';
import { StableConfig, isStableEligiblePair } from '../../config/stables.js';
import { QuoteParams, QuoteResult } from '../DexQuoter.js';
import { Token } from '../../core/types.js';
import { log } from '../../core/log.js';

const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from,address to,bool stable,address factory)[] routes) external view returns (uint256[] amounts)'
];
const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)'];
const ZERO = '0x0000000000000000000000000000000000000000';

interface CachedQuote {
  expiryMs: number;
  result: QuoteResult | null;
}

const summarizeErr = (error: unknown): string => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : 'ERR';
  const msg = error instanceof Error ? error.message : String(error);
  return `${code}: ${msg}`.slice(0, 180);
};

export class AerodromeQuoter {
  public readonly id = 'aerodrome';
  private readonly router: Contract;
  private readonly factory: Contract;
  private readonly cache = new Map<string, CachedQuote>();
  private readonly ttlMs = 8_000;
  private lastError = '';
  private selectorLogged = false;

  constructor(rpcUrl: string, private readonly stableConfig: StableConfig) {
    const provider = new JsonRpcProvider(rpcUrl);
    this.router = new Contract(AERODROME_ROUTER, ROUTER_ABI, provider);
    this.factory = new Contract(AERODROME_FACTORY, FACTORY_ABI, provider);

    const selector = this.router.interface.getFunction('getAmountsOut')?.selector ?? 'unknown';
    if (selector !== '0x5509a1ac') {
      throw new Error(`Aerodrome ABI mismatch: expected selector 0x5509a1ac, got ${selector}`);
    }
  }

  getLastError(includeSelector = false): string {
    if (!includeSelector) return this.lastError;
    const selector = this.router.interface.getFunction('getAmountsOut')?.selector ?? 'unknown';
    return `[selector:${selector}] ${this.lastError}`.trim();
  }

  canUseStable(tokenIn: Token, tokenOut: Token): boolean {
    return isStableEligiblePair(tokenIn, tokenOut, this.stableConfig);
  }



  private maybeLogSelectorInvariant(): void {
    if (this.selectorLogged) return;
    if (!process.argv.includes('--debugHops') && !process.argv.includes('--selfTest')) return;

    const selector = this.router.interface.getFunction('getAmountsOut')?.selector ?? 'unknown';
    if (selector !== '0x5509a1ac') {
      throw new Error(`Aerodrome selector mismatch: expected 0x5509a1ac, got ${selector}`);
    }
    log.info('aerodrome-selector', { selector, expectedSelector: '0x5509a1ac' });
    this.selectorLogged = true;
  }

  encodeGetAmountsOutCalldata(tokenIn: string, tokenOut: string, amountIn: bigint, stable: boolean): string {
    const routes: [string, string, boolean, string][] = [[tokenIn, tokenOut, stable, AERODROME_FACTORY]];
    return this.router.interface.encodeFunctionData('getAmountsOut', [amountIn, routes]);
  }


  async quoteExactIn(params: QuoteParams, callsite = 'unknown'): Promise<QuoteResult | null> {
    if (process.argv.includes('--debugHops') || process.argv.includes('--selfTest')) {
      const selector = this.router.interface.getFunction('getAmountsOut')?.selector ?? 'unknown';
      const calldata = this.encodeGetAmountsOutCalldata(params.tokenIn.address, params.tokenOut.address, params.amountIn, false);
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

    try {
      const pool = await this.factory.getPool(tokenIn.address, tokenOut.address, stable);
      if (pool === ZERO) {
        const result = null;
        this.cache.set(key, { expiryMs: now + this.ttlMs, result });
        this.lastError = stable ? 'STABLE_SKIPPED: no pool' : 'NO_POOL: aerodrome volatile pair not deployed';
        return result;
      }

      const routes: [string, string, boolean, string][] = [[tokenIn.address, tokenOut.address, stable, AERODROME_FACTORY]];
      const amounts: bigint[] = await this.router.getFunction('getAmountsOut').staticCall(amountIn, routes);
      const amountOut = amounts[amounts.length - 1];
      const result = amountOut > 0n ? { amountOut, gasUnitsEstimate: undefined, meta: { stable } } : null;
      this.cache.set(key, { expiryMs: now + this.ttlMs, result });
      this.lastError = result ? '' : 'ZERO_OUT: aerodrome returned zero amount';
      return result;
    } catch (error) {
      const summary = summarizeErr(error);
      this.lastError = stable ? `STABLE_REVERT_EXPECTED: ${summary}` : summary;
      this.cache.set(key, { expiryMs: now + this.ttlMs, result: null });
      return null;
    }
  }
}
