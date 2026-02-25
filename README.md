# ArbiClaw (Base triangular arb simulator, dry-run)

Dry-run triangular arbitrage scanner for Base. It never sends transactions.

## Setup
1. `npm i`
2. `cp .env.example .env`
3. Set `BASE_RPC_URL` in `.env`

## Run
Default (uses repo defaults: uniswapv3+aerodrome, maxCombosPerTriangle=300, timeBudgetMs=15000):
```bash
npm run dev -- --amount 100 --minProfit 0 --top 10
```

Requested mixed-DEX run:
```bash
npm run dev -- --dexes uniswapv3,aerodrome --tokenSubset USDC,WETH,AERO --amount 100 --minProfit 0 --top 10
```

With explicit fee preferences and hop debugging:
```bash
npm run dev -- --dexes uniswapv3,aerodrome --tokenSubset USDC,WETH,AERO --feeConfig config/fees.json --debugHops
```

## Self-test
Run quoting checks without triangle scanning:
```bash
npm run dev -- --selfTest
```

For Aerodrome, volatile is always checked first; stable is skipped for non-stable-eligible pairs unless explicitly allowed.

## Key flags
- `--dexes <csv>` default `uniswapv3,aerodrome`
- `--fees <csv>` default `500,3000,10000` (fallback Uniswap fee tiers)
- `--feeConfig <path>` default `config/fees.json` (pair fee-tier preferences; symmetric lookup)
- `--aeroStablePairs <path>` default `config/aerodrome.stablePairs.json` (force stable-eligible Aerodrome pairs)
- `--tokenSubset <csv>` must include `USDC`
- `--maxTriangles <n>` cap triangle candidates
- `--maxCombosPerTriangle <n>` default `300`
- `--maxTotalQuotes <n>` default `4000`
- `--timeBudgetMs <n>` default `15000`
- `--quoteConcurrency <n>` default `6`
- `--selfTest` run quote diagnostics only
- `--debugHops` print first hop-option skips and quote failures

## Output
Top results print full hop labels, e.g.
`USDC -(UNI:500)-> WETH -(AERO:vol)-> AERO -(UNI:3000)-> USDC`

Stats include:
- triangles considered
- triangles skipped due to no hop options
- combos enumerated
- quote attempts / quote failures
- hop options distribution: avg/min/max per hop
- errorsByDex, errorsByHop, topErrorsByDex

## Notes
- Simulation-only (no execution path / no trades).
- Uniswap v3 uses QuoterV2 struct ABI static calls.
- Pair-specific fee preferences are loaded from `config/fees.json`.
- AERO hops are Aerodrome-first in ordering only; Uniswap options are still enumerated when pools exist.


## JSON output

Write scan output to a JSON file:

```bash
npm run dev -- --dexes uniswapv3,aerodrome --tokenSubset USDC,WETH,AERO --json out/results.json
```

Write JSON to stdout instead (logs are redirected to stderr so stdout stays machine-readable):

```bash
npm run dev -- --dexes uniswapv3,aerodrome --tokenSubset USDC,WETH,AERO --json -
```


## Human-readable output

Default CLI output is concise and human-readable: header, top completed routes, then summary stats.

Example:

```text
=== ArbiClaw Simulation ===
chain=Base | rpc=mainnet.base.org | dexes=uniswapv3,aerodrome
tokens=AERO,USDC,WETH | amount=100 | maxTriangles=50 | maxCombosPerTriangle=300 | timeBudgetMs=15000

Top routes (completed):
 1. USDC-(UNI:500)->WETH WETH-(UNI:500)->AERO AERO-(AERO:vol/via WETH)->USDC
    startUSDC=100.000000 endUSDC=99.367105 hops=3
    gross=-0.632895 gas=NA net=NA

Summary:
trianglesConsidered=12 combosEnumerated=96 completedRoutes=12 quoteAttempts=240 quoteFailures=21 elapsedMs=14876 timeBudgetMs=15000
stoppedEarly=true (time budget)
errorCountersByDex:
  aerodrome: timeouts=1 callExceptions=14 other=3 total=18
  uniswapv3: timeouts=0 callExceptions=2 other=1 total=3
```
