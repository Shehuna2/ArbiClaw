import { formatFixed } from './math.js';

export const formatUsdc = (value: bigint): string => formatFixed(value, 6, 6);

export const formatSignedUsdc = (value: bigint): string => {
  if (value > 0n) return `+${formatUsdc(value)}`;
  if (value < 0n) return `-${formatUsdc(-value)}`;
  return '+0.000000';
};

export const padRight = (value: string, width: number): string => (value.length >= width ? value : `${value}${' '.repeat(width - value.length)}`);

export const padLeft = (value: string, width: number): string => (value.length >= width ? value : `${' '.repeat(width - value.length)}${value}`);
