# ArbiClaw (Base triangular arb simulator, dry-run)

Dry-run triangular arbitrage scanner for Base. It never sends transactions.

## Stack
- Node.js + TypeScript (ESM)
- ethers v6
- dotenv

## Setup
1. Install dependencies:
   ```bash
   npm i
   ```
2. Create env:
   ```bash
   cp .env.example .env
   ```
3. Set `BASE_RPC_URL` in `.env`.

## Run (dev)
Default run (Uniswap v3 only):
```bash
npm run dev -- --amount 100 --minProfit 0 --top 10
```

Token subset example:
```bash
npm run dev -- --amount 100 --minProfit 0 --top 10 --tokenSubset USDC,WETH,AERO,DEGEN --maxTriangles 2000
```

Enable Aerodrome + Uniswap:
```bash
npm run dev -- --dexes uniswapv3,aerodrome --tokenSubset USDC,WETH,AERO --maxTriangles 500
```

## CLI flags
- `--rpc <url>`: override `BASE_RPC_URL`
- `--amount <number>`: input USDC amount
- `--minProfit <number>`: minimum net profit threshold in USDC
- `--top <number>`: number of opportunities to print
- `--maxTriangles <number>`: safety cap for generated candidates
- `--fees <csv>`: Uniswap v3 fee tiers, default `500,3000,10000`
- `--tokens <path>`: token registry JSON path, default `tokens/base.top.json`
- `--tokenSubset <csv>`: restrict symbols from token registry (must include `USDC`)
- `--dexes <csv>`: enabled DEX quoters, default `uniswapv3`

## Build + run
```bash
npm run build
npm start -- --amount 100 --minProfit 0 --top 5
```

## Current limitations
- Simulation only (no execution).
- Aerodrome quoting is best-effort and may skip illiquid/unroutable pairs.
- Some generated routes have no available pools/quotes and are skipped.
- Routes are 2-hop USDC→TOKEN→USDC cycles with per-hop dex selection.
- Gas is approximated in USDC from quote estimates and provider fee data.
