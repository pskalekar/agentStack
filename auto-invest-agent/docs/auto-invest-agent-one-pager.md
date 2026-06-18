# Auto-Invest Agent — One-Pager

> **Personal exploration — not an official Circle product or endorsed sample.**
> A demo of one way a developer *could* build with the Circle Agent Stack. Testnet only.

**Status:** Draft · **Date:** 2026-06-18

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

The buffer is sized as a **number of tasks** (each task = its payment + gas), so most tasks are
paid straight from liquid and the agent only redeems *occasionally* to top back up:

```
        ┌──────────────────────────────────────────────────────────────┐
        │  1. Hold USDC; keep a liquid buffer ≈ N tasks (cost + gas)     │
        │  2. Sweep balance above the buffer into the yield vault        │
        │  3. Pay each task straight from the buffer                     │
        │  4. When liquid drops to ≈ M tasks, refill from the vault once │
        │  5. Pay via Nanopayments / x402  (demo: a USDC transfer)       │
        │  └────────────────────────── repeat ───────────────────────────┘
```

Refilling is the **exception, not the rule** — one withdrawal covers many tasks, so the agent
rarely pays the latency/gas of a redemption.

A live **dashboard** shows **liquid vs. earning balance**, **runway** (how many more tasks it can
fund), and an **activity feed** of every sweep, refill, and payment with on-chain links.

## What it demonstrates

- An agent can treat its wallet as a managed treasury, not a static balance.
- Earning and spending compose cleanly when the earn leg sits behind a simple interface.
- A working float sized in *tasks* keeps redemptions occasional — yield without paying a
  withdrawal on every payment.
- The whole thing runs against **real testnet contracts** — real deposits, withdrawals, and
  payments — not mocks, and is covered by a unit-test suite for the buffer/refill/gas logic.

## What it is *not*

- Not financial advice or a yield product. It uses whatever public testnet vault you point it at.
- Not production-ready. Testnet only, no real funds, secrets via environment variables.
- Not an official integration — it talks to a yield vault directly via standard ERC-4626 calls.

## Try it

1. `npm install`, then `cp .env.example .env`.
2. Set your testnet key, a vault address, and a payee in `.env`; get testnet USDC from the
   [Circle faucet](https://faucet.circle.com). Tune the policy via `TASK_COST_USDC`,
   `BUFFER_TASKS`, and `LOW_WATER_TASKS`.
3. `npm run demo` — watch the agent invest idle USDC, pay tasks from the buffer, and refill once
   the buffer runs low (each step prints an explorer link).
4. `npm run dashboard` — open the live view at `http://localhost:3007`.
5. `npm test` — run the unit suite (no chain, no funds needed).

See [`auto-invest-agent-design.md`](./auto-invest-agent-design.md) for the architecture and design decisions.
