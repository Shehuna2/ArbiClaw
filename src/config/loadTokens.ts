import { readFile } from 'node:fs/promises';
import { Token } from '../core/types.js';

interface TokenRecord {
  symbol: unknown;
  address: unknown;
  decimals: unknown;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export const loadTokens = async (path: string): Promise<Token[]> => {
  const raw = await readFile(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Token registry at ${path} must be an array.`);
  }

  const symbols = new Set<string>();
  const addresses = new Set<string>();

  return parsed.map((entry, idx) => {
    const rec = entry as TokenRecord;
    const symbol = String(rec.symbol ?? '').trim();
    const address = String(rec.address ?? '').trim();
    const decimals = Number(rec.decimals);

    if (!symbol) throw new Error(`Token[${idx}] invalid symbol.`);
    if (symbols.has(symbol)) throw new Error(`Duplicate token symbol: ${symbol}`);
    if (!ADDRESS_RE.test(address)) throw new Error(`Token ${symbol} has invalid address: ${address}`);
    const addrKey = address.toLowerCase();
    if (addresses.has(addrKey)) throw new Error(`Duplicate token address: ${address}`);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new Error(`Token ${symbol} has invalid decimals: ${String(rec.decimals)}`);
    }

    symbols.add(symbol);
    addresses.add(addrKey);

    return { symbol, address: address as `0x${string}`, decimals };
  });
};
