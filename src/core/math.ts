import { formatUnits } from 'ethers';

const POW10 = (decimals: number): bigint => 10n ** BigInt(decimals);

export const parseDecimalToUnits = (value: string, decimals: number): bigint => {
  const raw = value.trim();
  if (!raw) throw new Error('Decimal value cannot be empty.');
  if (/e/i.test(raw)) throw new Error(`Scientific notation is not supported: ${value}`);

  const sign = raw.startsWith('-') ? -1n : 1n;
  const normalized = raw.replace(/^[+-]/, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const [wholePart, fracPart = ''] = normalized.split('.');
  const whole = BigInt(wholePart || '0');
  const truncatedFrac = fracPart.slice(0, decimals).padEnd(decimals, '0');
  const fraction = truncatedFrac ? BigInt(truncatedFrac) : 0n;
  const units = (whole * POW10(decimals)) + fraction;
  return sign < 0n ? -units : units;
};

export const toUnits = (value: string, decimals: number): bigint => parseDecimalToUnits(value, decimals);

export const fromUnits = (value: bigint, decimals: number): number => Number(formatUnits(value, decimals));

export const formatFixed = (value: bigint, decimals: number, places = 6): string => {
  return fromUnits(value, decimals).toFixed(places);
};

export const cmpBigintDesc = (a: bigint, b: bigint): number => (
  b > a ? 1 : b < a ? -1 : 0
);
