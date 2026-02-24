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

Mixed venues with subset:
```bash
npm run dev -- --dexes uniswapv3,aerodrome --tokenSubset USDC,WETH,AERO,DEGEN --maxTriangles 300
```

## Self-test
Run quoting checks without triangle scanning:
```bash
npm run dev -- --selfTest
```

Each line is JSON pass/fail, e.g.:
- `{"dex":"uniswapv3","pair":"USDC/WETH","ok":true,"amountOut":"..."}`
- `{"dex":"aerodrome","pair":"USDC/WETH","ok":false,"err":"CALL_EXCEPTION: ..."}`

Interpretation:
- At least one `ok:true` means quoting path is operational.
- If all fail, check `BASE_RPC_URL`, DEX addresses, pool existence, and returned error summaries.

## Key flags
- `--dexes <csv>` default `uniswapv3,aerodrome`
- `--fees <csv>` default `500,3000,10000` (Uniswap fee tiers)
- `--tokenSubset <csv>` must include `USDC`
- `--maxTriangles <n>` cap triangle count
- `--maxCombosPerTriangle <n>` default `300`
- `--maxTotalQuotes <n>` default `4000`
- `--timeBudgetMs <n>` default `15000`
- `--quoteConcurrency <n>` default `6`
- `--selfTest` run quote diagnostics only

## Output
Top results print full hop labels, e.g.
`USDC -(UNI:500)-> WETH -(AERO:vol)-> AERO -(UNI:3000)-> USDC`

Stats include:
- triangles considered
- combos enumerated
- quote errors/skips
- quotes attempted
- errorsByDex, errorsByHop, topErrorsByDex

## Notes
- Simulation-only (no execution path).
- Aerodrome quotes are best-effort; illiquid pairs may be skipped.
- Quote failures are handled and skipped without crashing.

## Why this hotfix
- Corrected Aerodrome router address on Base for quote calls.
- Fixed BigInt profit sorting to avoid unsafe `Number(...)` conversion and preserve ordering correctness.
