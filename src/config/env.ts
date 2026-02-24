import dotenv from 'dotenv';
import { ScanConfig } from '../core/types.js';

dotenv.config();

const DEFAULT_FEES = [500, 3000, 10000];
const DEFAULT_TOKENS_PATH = 'tokens/base.top.json';

const getArgValue = (name: string): string | undefined => {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
};

const getNumArg = (name: string, fallback: number): number => {
  const raw = getArgValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid --${name}: ${raw}`);
  return value;
};

export const parseConfig = (): ScanConfig => {
  const rpcUrl = getArgValue('rpc') ?? process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error('Missing RPC URL. Pass --rpc or set BASE_RPC_URL.');

  const feesRaw = getArgValue('fees');
  const fees = feesRaw ? feesRaw.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x)) : DEFAULT_FEES;
  if (!fees.length) throw new Error('No valid fees provided.');

  const tokenSubsetRaw = getArgValue('tokenSubset');
  const tokenSubset = tokenSubsetRaw
    ? tokenSubsetRaw.split(',').map((x) => x.trim()).filter((x) => x.length > 0)
    : undefined;

  return {
    rpcUrl,
    amountInHuman: getNumArg('amount', 100),
    minProfitHuman: getNumArg('minProfit', 0),
    topN: getNumArg('top', 20),
    maxTriangles: getNumArg('maxTriangles', 200),
    fees,
    tokensPath: getArgValue('tokens') ?? DEFAULT_TOKENS_PATH,
    tokenSubset
  };
};
