# ArbiClaw (Base triangular arb simulator, dry-run)

Dry-run triangular arbitrage scanner for Base using Uniswap v3 quotes only. It never sends transactions.

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
Default token universe (`tokens/base.top.json`):
```bash
npm run dev -- --amount 100 --minProfit 0 --top 10
```

Token subset example:
```bash
npm run dev -- --amount 100 --minProfit 0 --top 10 --tokenSubset USDC,WETH,AERO,DEGEN --maxTriangles 2000
```

## CLI flags
- `--rpc <url>`: override `BASE_RPC_URL`
- `--amount <number>`: input USDC amount
- `--minProfit <number>`: minimum net profit threshold in USDC
- `--top <number>`: number of opportunities to print
- `--maxTriangles <number>`: safety cap for generated candidates
- `--fees <csv>`: fee tiers, default `500,3000,10000`
- `--tokens <path>`: token registry JSON path, default `tokens/base.top.json`
- `--tokenSubset <csv>`: restrict symbols from token registry (must include `USDC`)

## Build + run
```bash
npm run build
npm start -- --amount 100 --minProfit 0 --top 5
```

## Current limitations
- Uniswap v3 only.
- Some generated routes have no available pools and are skipped.
- Routes are 2-hop USDC→TOKEN→USDC fee-tier cycles.
- Gas is approximated in USDC from quote gasEstimate and fee data.
