import { formatUnits, parseUnits } from 'ethers';

export const toUnits = (value: number, decimals: number): bigint => parseUnits(value.toString(), decimals);

export const fromUnits = (value: bigint, decimals: number): number => Number(formatUnits(value, decimals));

export const formatFixed = (value: bigint, decimals: number, places = 6): string => {
  return fromUnits(value, decimals).toFixed(places);
};

export const cmpBigintDesc = (a: bigint, b: bigint): number => (
  b > a ? 1 : b < a ? -1 : 0
);
