import { Contract, JsonRpcProvider } from 'ethers';
import { QuoteResult } from '../DexQuoter.js';
import { Token } from '../../core/types.js';

const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7C97c74d54e5b648dEecf97';
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';
const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from,address to,bool stable,address factory)[] routes) external view returns (uint256[] amounts)'
];

interface CachedQuote {
  expiryMs: number;
  result: QuoteResult | null;
}

export class AerodromeQuoter {
  public readonly id = 'aerodrome';
  private readonly router: Contract;
  private readonly cache = new Map<string, CachedQuote>();
  private readonly ttlMs = 8_000;

  constructor(rpcUrl: string) {
    const provider = new JsonRpcProvider(rpcUrl);
    this.router = new Contract(AERODROME_ROUTER, ROUTER_ABI, provider);
  }

  async quoteByMode(tokenIn: Token, tokenOut: Token, amountIn: bigint, stable: boolean): Promise<QuoteResult | null> {
    const key = `${tokenIn.address}:${tokenOut.address}:${amountIn.toString()}:${stable ? 's' : 'v'}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiryMs > now) return hit.result;

    try {
      const amounts: bigint[] = await this.router.getAmountsOut(amountIn, [{
        from: tokenIn.address,
        to: tokenOut.address,
        stable,
        factory: AERODROME_FACTORY
      }]);
      const amountOut = amounts[amounts.length - 1];
      const result = amountOut > 0n
        ? { amountOut, gasUnitsEstimate: undefined, meta: { stable } }
        : null;
      this.cache.set(key, { expiryMs: now + this.ttlMs, result });
      return result;
    } catch {
      this.cache.set(key, { expiryMs: now + this.ttlMs, result: null });
      return null;
    }
  }
}
