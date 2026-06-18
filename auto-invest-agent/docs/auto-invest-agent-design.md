# Auto-Invest Agent — Engineering Design

> **Personal exploration — not an official Circle product or endorsed sample.**
> This is a demonstration of one way a developer could build on the Circle Agent Stack.
> It runs on **testnet only**, uses no real funds, and is not intended for production use
> without modification.

**Author:** pskalekar · **Status:** Draft · **Date:** 2026-06-18

---

## 1. Related Documents

| Document | Link |
|---|---|
| One-pager (the "what" and "why") | [`ONE-PAGER.md`](./ONE-PAGER.md) |
| Arc developer docs | https://docs.arc.network |
| Circle developer docs | https://developers.circle.com |
| ERC-4626 tokenized vault standard | https://eips.ethereum.org/EIPS/eip-4626 |
| x402 payment standard | https://www.x402.org |
| Morpho protocol docs | https://docs.morpho.org |

---

## 2. Background & Goals

### Problem

An AI agent with a wallet typically does two things with USDC: **holds** it and **spends** it.
But an agent that operates over time has a *treasury* — a balance meant to last across many
tasks. Stablecoin held idle earns nothing, so any USDC the agent isn't actively spending is an
opportunity cost. The interesting question is whether an agent can manage that treasury itself:
keep enough liquid to operate, put the rest to work, and rebalance on demand.

### What this system does

A long-running agent process that:

1. Holds USDC in an agent wallet, keeping a configurable liquid **buffer**.
2. Sweeps balance above the buffer into an on-chain **yield vault** (ERC-4626).
3. When it needs to pay for a service and is short on liquid USDC, **withdraws just enough**
   from the vault.
4. **Pays** for the service via the Circle CLI's Nanopayments / x402 support.
5. Surfaces its state — liquid vs. earning balance, yield accrued, runway — on a thin dashboard.

It targets **Arc testnet**, where USDC is the native gas token, so the agent never needs a
second asset to pay fees.

### Goals

- Show a clean, real (non-mocked) end-to-end loop: **hold → earn → just-in-time withdraw → pay.**
- Keep the earn integration behind a small interface so the yield source is swappable.
- Be runnable by any developer with a testnet wallet in a few minutes.
- Model good practice: testnet only, secrets via environment, honest yield reporting.

### Non-goals

- Not a yield product, not financial advice, not a recommendation of any vault.
- No production hardening (key custody, monitoring, retries-at-scale, circuit breakers).
- No mainnet. No real funds.
- Not a general treasury optimizer — the allocation policy is intentionally trivial (buffer +
  sweep), so the *composition* is the lesson, not the strategy.

---

## 3. Design Considerations & Tradeoffs

### 3.1 Talk to the vault directly via ERC-4626 (chosen) vs. a higher-level earn SDK

**Chosen:** interact with the yield vault directly using the standard **ERC-4626** interface
(`deposit`, `withdraw`/`redeem`, `convertToAssets`, `convertToShares`, `totalAssets`,
`balanceOf`) through [viem](https://viem.sh).

- **Pro:** zero extra dependencies, fully transparent, works against any ERC-4626 vault on any
  EVM chain, and is verifiable on a block explorer. Nothing hidden.
- **Con:** we implement deposit/withdraw/position math ourselves, including decimals handling.
- **Rejected alternative:** wrapping a higher-level "earn" SDK. That would hide the mechanics
  the demo is meant to *show*, and couple the demo to a specific package. To keep the door open,
  the earn logic sits behind an `EarnProvider` interface (§5.1) — a different provider can be
  dropped in later without touching the agent loop.

### 3.2 Vault shares ≠ underlying amount (decimals)

ERC-4626 vault **shares** and the **underlying asset** often use different decimals (e.g. shares
in 18 decimals, USDC in 6). Treating them as 1:1 silently corrupts every amount.

**Decision:** never assume parity. Always convert through `convertToAssets()` /
`convertToShares()`, and keep all internal math in the asset's smallest unit (USDC base units,
6 decimals) using `bigint`, converting to human units only at the display edge.

### 3.3 How to report yield / APY

On-chain vaults don't reliably expose a clean APY, and off-chain APY indexes don't always cover
every chain or testnet.

**Decision:** report **realized** yield, derived from the change in share price
(`convertToAssets(shares)` over time) since the agent's first deposit. Any headline APY shown is
clearly labeled **illustrative**. We never fabricate a precise yield number.

### 3.4 Sizing the buffer: a working float in *tasks*, refilled occasionally

Keeping all USDC liquid is simplest but earns nothing. Keeping everything in the vault maximizes
yield but means every payment incurs a withdrawal (latency + gas). And sizing the buffer as a
*fraction* of a task is worst of all — every task would trigger a redemption.

**Decision:** a **two-threshold working float, sized in tasks**, where each task's all-in cost is
its payment **plus gas** (`per-task = TASK_COST_USDC + GAS_PER_TASK_USDC`):
- **High-water (buffer)** = `BUFFER_TASKS × per-task` — the liquid target. `sweepIdle` invests
  everything above it.
- **Low-water (refill trigger)** = `LOW_WATER_TASKS × per-task`. When liquid drops below it, the
  agent **refills back up to the high-water buffer in a single withdrawal**.

So most tasks are paid straight from liquid, and a redemption happens only every
`(BUFFER_TASKS − LOW_WATER_TASKS)` tasks or so — redeeming is the exception, not the rule. This
mirrors a treasurer keeping a checking-account float over a savings account, and it makes the
buffer auto-scale: change the task cost and the absolute thresholds move with it.

Two real-world caveats the implementation handles:
- **Withdrawals can be liquidity-limited.** A lending vault's withdrawable amount
  (`maxWithdraw`) can be *less than* the position value — even zero — if the underlying market
  has no free liquidity. The agent caps every withdrawal at `maxWithdraw()` and fails loudly if
  it still can't cover the cost, rather than reverting mid-transaction.
- **Every write's receipt status is checked.** A reverted transaction still returns a receipt;
  the agent treats `status !== 'success'` as an error so a failed deposit/withdraw/payment can
  never be mistaken for a successful one.

### 3.5 Chain choice: Arc testnet

**Decision:** **Arc testnet**, because USDC is the native gas token — the agent pays gas in the
same asset it manages, removing the "need a second token for fees" wrinkle that complicates the
story on other chains. Arc is EVM-compatible, so the code is standard viem/ERC-4626 and could be
pointed at another EVM testnet by changing config.

### 3.6 Yield source: a permissionless ERC-4626 lending vault (chosen) vs. USYC

The agent earns by supplying idle USDC to a **permissionless ERC-4626 vault** — concretely a
Morpho USDC lending vault on Arc, where the yield comes from borrowers paying interest (reflected
in the vault's share price).

- **Rejected alternative: USYC** (a tokenized money-market fund redeemable to USDC). It's a
  natural "earn" source, but access is **permissioned** — it requires KYC/AML and wallet
  allowlisting, and uses a Teller mint/redeem flow rather than a permissionless `deposit`. A demo
  meant to be cloned and run by anyone can't depend on that. The `EarnProvider` seam (§5.1) means
  a `UsycEarnProvider` could be added later for that flavor without changing the agent loop, but
  it would not be a drop-in (Teller + allowlist, not ERC-4626).
- **Note:** any ERC-4626 USDC vault works by changing `VAULT_ADDRESS`; verify a candidate on the
  block explorer (its `asset()` must equal the USDC address).

### 3.7 Gas reserve: never spend to zero (Arc specifics)

On Arc, USDC is *also* the native gas token, and the native balance and the ERC-20 USDC balance
are the **same pool**. So the agent can never spend ~100% of its balance — sending the payment
transaction deducts gas from the same USDC first, which would drop the balance below the transfer
amount and revert.

**Decision:** gas is treated as part of every task's cost. The per-task unit used for buffer
sizing (§3.4) is `TASK_COST_USDC + GAS_PER_TASK_USDC`, so the buffer and low-water inherently
carry gas headroom for the tasks they cover. On top of that, each payment keeps a gas-reserve
floor (one task's gas) and pays the **exact cost** — never the whole balance — so the payment tx
can always afford its own fee. The agent throws rather than paying if it can't keep that floor.

---

## 4. System Architecture

```
                          ┌──────────────────────────────┐
                          │        Agent process          │
                          │   (sweep / withdraw / pay)     │
                          └───────────────┬───────────────┘
              reads/writes                │                 invokes
        ┌──────────────────────┬──────────┴──────────┬───────────────────┐
        ▼                      ▼                     ▼                   ▼
 ┌─────────────┐      ┌─────────────────┐    ┌──────────────┐   ┌────────────────┐
 │ Agent wallet │      │  EarnProvider    │    │  PaymentLeg  │   │   Dashboard    │
 │   (USDC)     │      │ (ERC-4626 vault  │    │ (USDC xfer;  │   │  (Next.js, RO) │
 │              │      │   via viem)      │    │  x402 next)  │   │                │
 └──────┬───────┘      └────────┬─────────┘    └──────┬───────┘   └───────┬────────┘
        │                       │                     │                   │
        ▼                       ▼                     ▼                   ▼
              ───────────────  Arc testnet (USDC = native gas)  ───────────────
                 USDC token   ·   yield vault   ·   service payments
```

### Components

| Component | Responsibility |
|---|---|
| **Agent process** | Runs the loop: read balances, sweep, withdraw-on-demand, pay, emit events. |
| **EarnProvider** | Abstraction over the yield source. Default impl: `MorphoVaultProvider` (ERC-4626 via viem). |
| **PaymentLeg** | Pays for a service. Default impl: `TransferPaymentLeg` (USDC transfer); `X402PaymentLeg` (Nanopayments / x402) is future work behind the same interface. |
| **Dashboard** | Read-only Next.js view of liquid vs. earning balance, runway, and the activity feed. |

---

## 5. Detailed Design

### 5.1 The `EarnProvider` interface

The single seam that keeps the yield source swappable:

```ts
interface VaultPosition {
  shares: bigint;        // vault shares held (vault decimals — may differ from USDC)
  currentValue: bigint;  // convertToAssets(shares), in USDC base units
}

interface EarnProvider {
  /** Deposit USDC (6-decimal base units) into the yield source. */
  deposit(amountUSDC: bigint): Promise<{ txHash: Hash }>;
  /** Withdraw USDC (6-decimal base units) back to the wallet. */
  withdraw(amountUSDC: bigint): Promise<{ txHash: Hash }>;
  /** Max USDC currently withdrawable for this account (liquidity-limited). */
  maxWithdraw(): Promise<bigint>;
  /** Current on-chain position. */
  position(): Promise<VaultPosition>;
}
```

`MorphoVaultProvider` implements this against an ERC-4626 vault: `deposit` calls the vault's
`deposit(assets, receiver)`; `withdraw` calls `withdraw(assets, receiver, owner)`; `position`
reads `balanceOf` + `convertToAssets`; `maxWithdraw` reads the vault's withdrawable amount. All
decimal conversions are isolated here, and every write checks its receipt status (§3.4).

`position()` deliberately returns only **on-chain truth** (shares + current value). *Principal*
and *realized yield* are app-level concepts — derived from the agent's own deposit/withdraw
history, not something the vault knows — so they live in the agent layer, not the provider.

### 5.2 The agent loop

Both thresholds are absolute USDC, derived from the task-count knobs:
`BUFFER = BUFFER_TASKS × per-task` and `LOW_WATER = LOW_WATER_TASKS × per-task`,
where `per-task = TASK_COST_USDC + GAS_PER_TASK_USDC` (§3.4).

```
# sweepIdle(): invest everything above the buffer
liquid = usdc.balanceOf(wallet)
if liquid > BUFFER:
    earn.deposit(liquid - BUFFER)

# payForTask(cost): pay from the buffer; refill only when low
liquid = usdc.balanceOf(wallet)
if liquid < LOW_WATER:                                  # refill is the exception
    earn.withdraw(min(BUFFER - liquid, earn.maxWithdraw()))   # refill to high-water, liquidity-capped
    liquid = usdc.balanceOf(wallet)
if liquid < cost + GAS_RESERVE:
    raise "cannot cover task"                           # vault dry; fail loudly, never underpay
paymentLeg.pay(cost)                                    # pay EXACT cost; gas reserve stays behind
```

Because a refill tops liquid back up to the high-water buffer (not just enough for one task), a
single withdrawal covers many subsequent tasks — redemption fires roughly every
`BUFFER_TASKS − LOW_WATER_TASKS` tasks, not every task.

**Activity log.** The agent appends each sweep / refill / payment (amount + tx hash) to a local
`events.json` that the dashboard reads. Balances are always read live from chain (the source of
truth); the log is only history for the feed and runway. Full restart-resume (replaying state on
crash) is future work — see §9.

### 5.3 Payment leg

`PaymentLeg` is the swappable seam for "pay for a service." The shipped implementation,
`TransferPaymentLeg`, makes a real USDC ERC-20 transfer to a payee — a faithful stand-in for a
metered service charge (the payment is the point, not a response). A future `X402PaymentLeg`
implements the same interface using the Circle CLI's Nanopayments / x402 support (discover via
the marketplace `search`/`inspect`/`pay` flow) — no change to the agent loop.

### 5.4 Dashboard

A read-only **Next.js** app (`npm run dashboard`, port 3007):

- **Cards** — Total balance, Liquid (spendable), Earning (invested), and **Runway** (how many
  more tasks it can fund).
- **Split bar** — liquid vs. earning at a glance.
- **Activity feed** — every sweep, refill, and payment, each with a tx link to the explorer.
- **`/api/state`** reads balances **live from chain** every few seconds; **`/api/events`** reads
  the activity log (§5.2).

Implementation note: Next.js patches global `fetch` with caching, and viem's RPC transport uses
`fetch` — so the on-chain reads must opt out (`cache: 'no-store'` + `fetchCache = 'force-no-store'`)
or the dashboard shows stale balances. Realized yield is intentionally **not** shown as a headline
number (see §3.3): on a test vault that doesn't accrue, it would read ~0, and we don't fabricate.

### 5.5 Continuous mode

`npm run demo` is a one-shot; `npm run agent` is the long-running version — a loop that
**every `TICK_SECONDS`** sweeps idle funds and (every `TASK_EVERY_TICKS` ticks) pays a task. The
sweep-each-tick is what makes investment *continuous*: USDC wired to the agent gets invested on
the next tick, not only when a task happens (≤ `TICK_SECONDS` latency, since it polls rather than
subscribing to deposit events). The tick's decision logic lives in a pure, unit-tested `runTick`.

Two safeguards make the loop robust to slow/stuck transactions on testnet:
- **`confirm()` timeout** — `waitForTransactionReceipt` waits indefinitely by default, so a stuck
  tx would hang the agent forever; a timeout turns it into a retryable error instead.
- **Pending-nonce guard** — before acting, the loop compares the latest vs. pending nonce; if a
  tx is still in flight it skips the tick rather than queuing behind it or double-submitting.

---

## 6. Configuration

All config via environment variables; nothing secret is committed. `.env.example` ships with
safe placeholders; `.env` is git-ignored.

| Variable | Meaning |
|---|---|
| `RPC_URL` | Arc testnet RPC endpoint. |
| `AGENT_PRIVATE_KEY` | Testnet wallet key (testnet funds only — never a real key). |
| `USDC_ADDRESS` | USDC token address on the target chain. |
| `VAULT_ADDRESS` | ERC-4626 yield vault address (find/verify one on the block explorer). |
| `TASK_COST_USDC` | Approximate cost per task. |
| `GAS_PER_TASK_USDC` | Gas headroom per task (gas is USDC on Arc). |
| `BUFFER_TASKS` | High-water buffer, **in tasks** → `buffer = BUFFER_TASKS × (task + gas)`. |
| `LOW_WATER_TASKS` | Low-water refill trigger, **in tasks**. |
| `PAYEE_ADDRESS` | Demo: recipient of the stand-in service payment. |
| `DEMO_TASKS` | Demo: how many tasks to run. |
| `AGENT_ADDRESS` | Dashboard: account to display (optional; derived from the key otherwise). |

The buffer and low-water are **derived** from the task counts, so they auto-scale with the task
cost. Small defaults (task `0.1`, buffer `10` tasks, low-water `5` tasks) keep demos cheap.

> Find and verify a vault by inspecting candidate ERC-4626 contracts on the public block
> explorer (`asset()` should return the USDC address; `totalAssets()` should be non-zero). The
> demo does not endorse any specific vault — point it at one you've reviewed.

---

## 7. Testing & Verification

Three layers, cheapest first:

1. **Unit suite (`npm test`, Vitest)** — no chain, no funds, runs in ~0.5s. Covers the logic
   where bugs actually occur:
   - `AutoInvestAgent` — sweep above buffer; refill-to-buffer only below low-water (with the
     `== buffer` / `== low-water` boundaries); `maxWithdraw` cap; exact-cost payment; the
     gas-reserve guard (isolated: liquid between `cost` and `cost + reserve` must throw); and a
     multi-task **cadence invariant** (refill ⟺ below low-water; never overspends; not every task).
   - `MorphoVaultProvider` — the **18-dec shares → 6-dec USDC** conversion (§3.2); approve-then-
     deposit / skip-approve; `withdraw(assets, receiver, owner)`; and **revert → throws** (the
     receipt-status guard, §3.4).
   - `TransferPaymentLeg` and `confirm()` — exact-amount transfer, and **revert → throws** (the
     false-success regression guard).
   - `derivePolicy` — the task-count → USDC sizing math.
2. **`verify-earn` script** — against the configured vault on testnet: reads `asset()` /
   `decimals()` / `totalAssets()`, deposits a small amount, asserts `position()` reflects it,
   withdraws, asserts funds return. Proves the real on-chain earn leg.
3. **`demo` script (end-to-end)** — fund from the faucet → run N tasks → observe real deposit,
   real refill, and real payments, each verifiable on the explorer.

---

## 8. Security & Usage Model

This demo:

- Assumes **testnet / sandbox usage only**; never mainnet, never real funds.
- Reads secrets from **environment variables**; never stores keys in plaintext or commits them.
  `.gitignore` covers `.env*` and key files.
- Warns before interacting with any vault and instructs the reader to review the contract first.
- Is **not intended for production** without significant hardening (key management, allowance
  scoping, monitoring, failure handling).

---

## 9. Limitations & Future Work

- **Trivial allocation policy.** Buffer + sweep + low-water refill only. A real treasury would
  consider the gas cost of rebalancing, forecast burn, multiple vaults, and risk limits.
- **Payment leg is a stand-in.** `TransferPaymentLeg` sends a USDC transfer; the real
  Nanopayments / x402 leg (`X402PaymentLeg`) is future work behind the same interface (§5.3).
- **No restart-resume yet.** The agent re-reads live balances, but does not replay in-flight
  state across a crash mid-operation. The activity log is history only.
- **Single vault.** No diversification or APY comparison across sources.
- **Yield reporting is realized-only.** No forward APY projection (deliberate — see §3.3); on a
  non-accruing test vault it reads ~0.
- **Withdrawal latency/gas not optimized.** Each just-in-time withdrawal is a transaction; a
  production version would batch or pre-position liquidity.
- **Swappable earn source.** The `EarnProvider` seam means a different yield backend (another
  vault, or a higher-level earn SDK if one becomes available) can replace `MorphoVaultProvider`
  without changing the agent loop.
