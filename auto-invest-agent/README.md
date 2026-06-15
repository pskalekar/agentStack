# Auto-Invest Agent

An agent that automatically invests its idle USDC to earn yield, and pulls money back out —
just in time — to pay for the services it uses. **Testnet only.**

> _Personal exploration — not an official Circle product or endorsed sample._

- [One-pager](./docs/auto-invest-agent-one-pager.md) — what it is and why
- [Engineering design](./docs/auto-invest-agent-design.md) — architecture and design decisions

## Status

Early build. The first slice — the on-chain **earn leg** — is in place:

- `src/earn/EarnProvider` (interface) + `MorphoVaultProvider` (ERC-4626 via [viem](https://viem.sh))
- `src/scripts/verify-earn.ts` — proves deposit → position → withdraw against a real testnet vault

The agent loop, payment leg, and dashboard come next.

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env`:

- `VAULT_ADDRESS` — an ERC-4626 USDC vault on Arc testnet. Verify any candidate on
  [the explorer](https://testnet.arcscan.app): its `asset()` must equal `USDC_ADDRESS`.
- `AGENT_PRIVATE_KEY` — a **testnet** wallet key (testnet funds only — never a real key).
  Leave blank to run in read-only mode.

Fund your wallet with testnet USDC from the [Circle faucet](https://faucet.circle.com).

## Verify the earn leg

```bash
npm run verify-earn
```

- **No key set** → reads vault metadata and confirms `asset()` matches USDC (read-only).
- **Key set + funded** → deposits a small amount, confirms the position grew, withdraws it,
  and confirms the funds returned — each step with an explorer link.

## Run the demo

A single-pass run of the full auto-invest loop against real testnet contracts:

```bash
npm run demo
```

Set `PAYEE_ADDRESS` in `.env` (any testnet address) first. The demo:

1. Shows the agent's starting position (liquid vs. invested).
2. **Sweeps** idle USDC above `BUFFER_USDC` into the vault.
3. Receives a task costing `TASK_COST_USDC` — **withdraws just enough** from the vault, then
   **pays** (a USDC transfer standing in for a metered service call).
4. Shows the final position.

Every step is real on-chain, with explorer links. Keep `TASK_COST_USDC` above `BUFFER_USDC`
so the just-in-time withdrawal actually fires.

> The payment is a plain USDC transfer for now. A future `X402PaymentLeg` implements the same
> `PaymentLeg` interface using Nanopayments / x402 — no change to the agent loop.

## Notes

- USDC is the **native gas token** on Arc, so no second asset is needed for fees.
- Vault **shares** and **USDC** can use different decimals; all amounts here stay in USDC base
  units (6 decimals) and conversions go through the vault's `convertToAssets`/`convertToShares`.
- Secrets come from environment variables only; `.env` is git-ignored.
