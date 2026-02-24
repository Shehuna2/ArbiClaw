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
  maxCombosPerTriangle: number;
  maxTotalQuotes: number;
  timeBudgetMs: number;
  quoteConcurrency: number;
  selfTest: boolean;
  debugHops: boolean;
  fees: number[];
  feeConfigPath?: string;
  tokensPath: string;
  tokenSubset?: string[];
  dexes: string[];
}

export interface RouteHop {
  dex: string;
  tokenIn: Token;
  tokenOut: Token;
  label: string;
}

export interface RouteCandidate {
  id: string;
  tokens: [Token, Token, Token, Token];
}

export interface SimResult {
  route: RouteCandidate;
  hops: RouteHop[];
  startAmount: bigint;
  finalAmount: bigint;
  grossProfit: bigint;
  gasCostUsdc: bigint;
  netProfit: bigint;
  failed: boolean;
  failReason?: string;
}

export interface SimStats {
  trianglesConsidered: number;
  combosEnumerated: number;
  trianglesSkippedNoHopOptions: number;
  quoteAttempts: number;
  quoteFailures: number;
  errorsByDex: Record<string, number>;
  errorsByHop: Record<string, number>;
  topErrorsByDex: Record<string, string[]>;
}
