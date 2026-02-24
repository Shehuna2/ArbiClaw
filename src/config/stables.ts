import { readFile } from 'node:fs/promises';
import { Token } from '../core/types.js';

const DEFAULT_STABLE_SYMBOLS = ['USDC', 'USDT', 'DAI', 'USDE', 'USDBC', 'LUSD', 'TUSD'];

export interface StableConfig {
  stableSymbols: Set<string>;
  stablePairOverrides: Set<string>;
}

const pairKey = (a: string, b: string): string => [a.toUpperCase(), b.toUpperCase()].sort().join('/');

export const loadStablePairOverrides = async (path?: string): Promise<Set<string>> => {
  if (!path) return new Set();

  const raw = await readFile(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Stable pairs config at ${path} must be an array of "TOKENA/TOKENB" strings`);

  const out = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'string' || !entry.includes('/')) throw new Error(`Invalid stable pair entry: ${String(entry)}`);
    const [a, b] = entry.split('/').map((x) => x.trim().toUpperCase());
    if (!a || !b) throw new Error(`Invalid stable pair entry: ${entry}`);
    out.add(pairKey(a, b));
  }
  return out;
};

export const buildStableConfig = (tokens: Token[], stablePairOverrides: Set<string>): StableConfig => {
  const knownSymbols = new Set(tokens.map((t) => t.symbol.toUpperCase()));
  const stableSymbols = new Set([...DEFAULT_STABLE_SYMBOLS].filter((s) => knownSymbols.has(s)));
  if (knownSymbols.has('USDC')) stableSymbols.add('USDC');

  return { stableSymbols, stablePairOverrides };
};

export const isStableEligiblePair = (tokenIn: Token, tokenOut: Token, config: StableConfig): boolean => {
  const inSym = tokenIn.symbol.toUpperCase();
  const outSym = tokenOut.symbol.toUpperCase();
  if (config.stablePairOverrides.has(pairKey(inSym, outSym))) return true;
  return config.stableSymbols.has(inSym) && config.stableSymbols.has(outSym);
};
