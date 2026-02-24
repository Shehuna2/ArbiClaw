# ArbiClaw (Base triangular arb simulator, dry-run)

Dry-run triangular arbitrage scanner for Base. It never sends transactions.

## Setup
1. `npm i`
2. `cp .env.example .env`
3. Set `BASE_RPC_URL` in `.env`

## Run
Uniswap only:
```bash
npm run dev -- --dexes uniswapv3 --amount 100 --minProfit 0 --top 10
```

Mixed venues:
```bash
npm run dev -- --dexes uniswapv3,aerodrome --tokenSubset USDC,WETH,AERO,DEGEN --maxTriangles 300 --maxCombosPerTriangle 500
```

## Key flags
- `--dexes <csv>` default `uniswapv3`
- `--fees <csv>` default `500,3000,10000` (Uniswap fee tiers)
- `--tokenSubset <csv>` must include `USDC`
- `--maxTriangles <n>` cap triangle count
- `--maxCombosPerTriangle <n>` default `500`
- `--maxTotalQuotes <n>` default `4000`
- `--timeBudgetMs <n>` default `20000`
- `--quoteConcurrency <n>` default `6`

## Output
Top results print full hop labels, e.g.
`USDC -(UNI:500)-> WETH -(AERO:vol)-> AERO -(UNI:3000)-> USDC`

Stats include:
- triangles considered
- combos enumerated
- quote errors/skips
- quotes attempted

## Notes
- Simulation-only (no execution path).
- Aerodrome quotes are best-effort; illiquid pairs may be skipped.
- Quote failures are handled and skipped without crashing.
