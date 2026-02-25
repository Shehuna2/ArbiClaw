export type Address = `0x${string}`;

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface ScanConfig {
  rpcUrl: string;
  amountInHuman: string;
  minProfitHuman: string;
  topN: number;
  maxTriangles: number;
  maxCombosPerTriangle: number;
  maxTotalQuotes: number;
  timeBudgetMs: number;
  quoteConcurrency: number;
  selfTest: boolean;
  debugHops: boolean;
  traceAmounts: boolean;
  fees: number[];
  feeConfigPath?: string;
  aeroStablePairsPath?: string;
  tokensPath: string;
  tokenSubset?: string[];
  dexes: string[];
  jsonOutput?: string;
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


export interface DexErrorCounters {
  timeouts: number;
  callExceptions: number;
  other: number;
}

export interface SimStats {
  trianglesConsidered: number;
  combosEnumerated: number;
  trianglesSkippedNoHopOptions: number;
  quoteAttempts: number;
  quoteFailures: number;
  hop1OptionsAvg: number;
  hop2OptionsAvg: number;
  hop3OptionsAvg: number;
  hop1OptionsMin: number;
  hop2OptionsMin: number;
  hop3OptionsMin: number;
  hop1OptionsMax: number;
  hop2OptionsMax: number;
  hop3OptionsMax: number;
  errorsByDex: Record<string, number>;
  errorsByHop: Record<string, number>;
  topErrorsByDex: Record<string, string[]>;
  errorTypeCountersByDex: Record<string, DexErrorCounters>;
}
