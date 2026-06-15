# Auto-Invest Agent — One-Pager

> **Personal exploration — not an official Circle product or endorsed sample.**
> A demo of one way a developer *could* build with the Circle Agent Stack. Testnet only.

**Status:** Draft · **Date:** 2026-06-15

---

## What this is

A demo AI agent that **automatically invests its idle USDC to earn yield**, and pulls money
back out — just in time — to pay for the services it uses. Instead of leaving its wallet
balance sitting at a 0% return, the agent treats spare USDC as investable cash: it deposits the
excess into an on-chain yield vault, keeps a small liquid buffer for day-to-day spending, and
redeems from the vault only when a payment needs more than it has on hand.

In one sentence: **an agent that invests what it isn't spending, and spends from what it has
invested.**

## Why this is interesting

Agent wallets today mostly *hold* and *spend* USDC. But an agent with a balance it isn't
using is leaving money on the table — idle stablecoin earns nothing. The moment an agent has
a treasury (a budget to operate over days or weeks), the natural question is: *can it manage
that treasury itself?*

This demo answers yes, by combining three things the Agent Stack already gives you:

- **An agent wallet** that holds USDC under spending policy/caps.
- **A way to pay** for real services — pay-per-call via the Circle CLI's Nanopayments / x402
  support, no API keys or prepaid billing.
- **A yield position** — an ERC-4626 vault on Arc testnet (USDC is the native gas token there),
  reached directly on-chain.

Nothing here is exotic. The point is to show the *pattern*: idle capital → earning position →
just-in-time liquidation → payment, all driven by the agent on its own.

## The loop

```
        ┌─────────────────────────────────────────────────────────┐
        │  1. Hold USDC in the agent wallet (keep a small buffer)   │
        │  2. Sweep balance above the buffer into the yield vault   │
        │  3. Agent needs to pay for a service                      │
        │  4. Short on liquid USDC? Withdraw just enough from vault │
        │  5. Pay via Nanopayments / x402                           │
        │  └──────────────────────── repeat ────────────────────────┘
```

While it runs, a small dashboard shows: **liquid balance vs. earning balance**, **yield
accrued so far**, and **runway** (how long the agent can keep paying at its current burn).

## What it demonstrates

- An agent can treat its wallet as a managed treasury, not a static balance.
- Earning and spending compose cleanly when the earn leg sits behind a simple interface.
- The whole thing runs against **real testnet contracts** — real deposits, real withdrawals,
  real on-chain yield — not mocks.

## What it is *not*

- Not financial advice or a yield product. It uses whatever public testnet vault you point it at.
- Not production-ready. Testnet only, no real funds, secrets via environment variables.
- Not an official integration — it talks to a yield vault directly via standard ERC-4626 calls.

## Try it (once built)

1. Get testnet USDC from the [Circle faucet](https://faucet.circle.com).
2. Configure your wallet, the vault address, and a liquid buffer in `.env`.
3. Run the agent and watch idle USDC move into yield and back out to pay for a service.

See [`auto-invest-agent-design.md`](./auto-invest-agent-design.md) for the architecture and design decisions.
