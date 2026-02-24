import { readFile } from 'node:fs/promises';

export type FeePrefs = Record<string, number[]>;

const isValidFeeList = (value: unknown): value is number[] => Array.isArray(value) && value.every((x) => Number.isInteger(x) && Number(x) > 0);

export const loadFeePrefs = async (path?: string): Promise<FeePrefs> => {
  if (!path) return {};
  const raw = await readFile(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Fee config at ${path} must be an object mapping pair->fee[]`);
  }

  const prefs: FeePrefs = {};
  for (const [pairRaw, fees] of Object.entries(parsed)) {
    const pair = pairRaw.trim().toUpperCase();
    if (!pair.includes('/')) throw new Error(`Invalid fee pair key: ${pairRaw}`);
    if (!isValidFeeList(fees)) throw new Error(`Invalid fee list for pair: ${pairRaw}`);
    prefs[pair] = [...new Set(fees.map(Number))];
  }
  return prefs;
};

export const getPairFeeOrder = (tokenIn: string, tokenOut: string, defaults: number[], prefs: FeePrefs): number[] => {
  const direct = `${tokenIn.toUpperCase()}/${tokenOut.toUpperCase()}`;
  const reverse = `${tokenOut.toUpperCase()}/${tokenIn.toUpperCase()}`;
  const preferred = prefs[direct] ?? prefs[reverse];
  if (!preferred?.length) return defaults;
  return [...new Set([...preferred, ...defaults])];
};
