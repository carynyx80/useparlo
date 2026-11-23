# Parlo — trade the hype

Attention perps on BNB Chain. Go long or short, up to 20x, on how much attention a coin, trend or
influencer gets on crypto social. Positions are private: side, leverage and owner are hidden behind
zero-knowledge proofs generated in the browser.

- Site: https://useparlo.xyz (Vercel, `web/`)
- API: https://api.useparlo.xyz (Railway, `server/`)
- Spec: [SPEC.md](SPEC.md)

> **Status: unaudited, DEV trusted setup.** Do not accept real user funds until the circuits and
> contracts are audited and a multi-party Groth16 ceremony replaces the dev setup (see
> [circuits/README.md](circuits/README.md)). Guarded-launch caps are on by default
> (10k USDT per deposit, 250k USDT pool TVL).

## How it works

| Layer | What it does |
|---|---|
| `server/` indexer | Scores attention per market (Reddit, CoinGecko trending, Farcaster/X if keys set, simulator fallback). EMA-smoothed, ±20% cap per update. |
| `server/` reporter | Pushes scores to `AttentionOracle` every half epoch. |
| `AttentionOracle` | Per-market, per-epoch close/low/high. Rejects >20% moves. `getWindow` feeds close proofs. |
| `ParloPool` | Shielded USDT balance (2-in/2-out join-split notes) + private positions in two Poseidon Merkle trees. |
| `LiquidityVault` | LPs are the house (PLP shares). Reserves 9× margin per open position; ≤50% of assets at risk. |
| Circuits | `transact` (deposit/transfer/withdraw), `open` (hidden side + leverage), `close` (PnL + knock-out proven against the oracle window). |
| `server/` relayer | Submits withdraw/open/close proofs so the trading wallet never touches the pool publicly. |
| `web/` | Landing + trading app. Derives the shielded key from a wallet signature, scans encrypted notes, proves in-browser. |

Liquidation is "knock-out at close": the close proof must show the index never crossed the
position's liquidation level during its life, so no keeper ever sees a position.

## Develop

```bash
# contracts
cd contracts && forge build && forge test
# circuits (dev setup; rebuilds verifiers + web/public/zk)
cd circuits && npm i && npm run build && npm test
# backend
cd server && npm i && cp .env.example .env && npm run dev
# frontend
cd web && npm i && cp .env.example .env && npm run dev
```

## Deploy to BNB Chain mainnet

Run this yourself. Never paste a private key into chat, a file in this repo, or CI logs.

1. Fund a deployer wallet with ~0.1 BNB for gas. Ownership of every contract is transferred to the
   company wallet `0xB34296465F18F55003100e925aBc70656E224035` at the end of the script.
2. Pick a reporter hot wallet (used by the backend to push oracle values) and fund it with a little BNB.
3. Deploy (Ledger shown; `--interactive` prompts for a key in your terminal instead):

```bash
cd contracts
EPOCH_LENGTH=300 REPORTER_ADDRESS=<reporter-address> \
forge script script/Deploy.s.sol --rpc-url bsc --broadcast --ledger --sender <deployer-address>
```

   Addresses are written to `contracts/deployments/56.json`. The script refuses chain 56 without the
   real verifiers in `contracts/src/verifiers/`.
4. Backend (Railway → parlo-api → Variables): set `POOL_ADDRESS`, `ORACLE_ADDRESS`,
   `POOL_DEPLOY_BLOCK` (from 56.json), plus the secrets `REPORTER_PRIVATE_KEY` and
   `RELAYER_PRIVATE_KEY` (a separate relayer wallet funded with BNB for gas).
5. Frontend (Vercel → useparlo → Environment Variables): set `VITE_POOL_ADDRESS`,
   `VITE_ORACLE_ADDRESS`, `VITE_VAULT_ADDRESS`, and optionally `VITE_WC_PROJECT_ID`
   (WalletConnect/Reown), then redeploy.
6. Seed the vault: deposit USDT into `LiquidityVault` so positions can open (the reserve check needs
   assets). Owner-only settings (caps, reporters, pause) are called from the company wallet.
