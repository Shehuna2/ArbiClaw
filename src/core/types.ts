export type Address = `0x${string}`;

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface ScanConfig {
  rpcUrl: string;
  amountInHuman: number;
  minProfitHuman: number;
  topN: number;
  maxTriangles: number;
  fees: number[];
}

export interface RouteHop {
  dex: string;
  tokenIn: Token;
  tokenOut: Token;
  fee: number;
}

export interface RouteCandidate {
  id: string;
  hops: RouteHop[];
}

export interface HopQuote {
  amountIn: bigint;
  amountOut: bigint;
  gasEstimate?: bigint;
}

export interface SimResult {
  route: RouteCandidate;
  startAmount: bigint;
  finalAmount: bigint;
  grossProfit: bigint;
  gasCostUsdc: bigint;
  netProfit: bigint;
  failed: boolean;
  failReason?: string;
}
