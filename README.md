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
```bash
npm run dev -- --amount 100 --minProfit 0.05 --top 20
```

## CLI flags
- `--rpc <url>`: override `BASE_RPC_URL`
- `--amount <number>`: input USDC amount
- `--minProfit <number>`: minimum net profit threshold in USDC
- `--top <number>`: number of opportunities to print
- `--maxTriangles <number>`: safety cap for generated candidates
- `--fees <csv>`: fee tiers, default `500,3000,10000`

## Build + run
```bash
npm run build
npm start -- --amount 100 --minProfit 0 --top 5
```

## Current limitations
- Uniswap v3 only.
- Token list is minimal (`USDC`, `WETH`).
- Routes are currently 2-hop USDC↔WETH fee-tier cycles.
- Gas is approximated in USDC from quote gasEstimate and fee data.
