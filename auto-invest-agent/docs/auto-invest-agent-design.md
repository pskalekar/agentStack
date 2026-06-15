# Auto-Invest Agent — Engineering Design

> **Personal exploration — not an official Circle product or endorsed sample.**
> This is a demonstration of one way a developer could build on the Circle Agent Stack.
> It runs on **testnet only**, uses no real funds, and is not intended for production use
> without modification.

**Author:** pskalekar · **Status:** Draft · **Date:** 2026-06-15

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

### 3.4 Just-in-time withdrawal vs. keeping everything liquid

Keeping all USDC liquid is simplest but earns nothing — defeating the demo. Keeping everything in
the vault maximizes yield but means every payment incurs a withdrawal (latency + gas).

**Decision:** a **buffer**. Keep `BUFFER_USDC` liquid; sweep the excess; withdraw only when a
payment would exceed the liquid balance. This mirrors how a human treasurer keeps a
checking-account float over a savings account. Two real-world caveats the implementation
handles:
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

**Decision:** keep a small `GAS_RESERVE_USDC` on hand at all times. When paying, the agent targets
`cost + gasReserve` liquid (withdrawing from the vault if needed), then pays the **exact cost** —
never the whole balance — leaving the reserve to fund the transaction fee.

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
 │   (USDC)     │      │ (ERC-4626 vault  │    │ (Nanopayments│   │  (Next.js, RO) │
 │              │      │   via viem)      │    │  / x402 CLI) │   │                │
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
| **PaymentLeg** | Pays for a service using the Circle CLI's Nanopayments / x402 support. |
| **Dashboard** | Read-only Next.js view of liquid vs. earning balance, realized yield, runway, event log. |

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

```
loop every TICK_SECONDS:
    liquid   = usdc.balanceOf(wallet)            # 6-decimal base units
    position = earn.position()

    # Sweep idle funds into yield
    if liquid > BUFFER_USDC + DUST:
        earn.deposit(liquid - BUFFER_USDC)

    # If there's work that costs money this tick:
    if task.pending and task.costUSDC > 0:
        liquid = usdc.balanceOf(wallet)          # re-read
        target = task.costUSDC + GAS_RESERVE     # keep gas headroom (USDC = gas on Arc)
        if liquid < target:
            shortfall = target - liquid
            earn.withdraw(min(shortfall, earn.maxWithdraw()))   # liquidity-capped
            liquid = usdc.balanceOf(wallet)
        if liquid < task.costUSDC:
            raise "cannot cover task"            # fail loudly, never underpay silently
        paymentLeg.pay(task.costUSDC)            # pay EXACT cost; reserve funds gas
        emit("paid", task)

    emit("tick", { liquid, position })
```

**State the agent persists** (local JSON or SQLite, for restart safety): cumulative principal
deposited, list of payments made, last processed tick. On restart it re-reads on-chain balances
and resumes — on-chain state is the source of truth; local state is only for history/runway.

### 5.3 Payment leg

Payments use the Circle CLI's Nanopayments / x402 support to call a real paid service
(discovered via the marketplace `search`/`inspect`/`pay` flow). The `PaymentLeg` shells out to
the CLI (or its SDK equivalent) and records the result. For the demo, the "service" is any small
paid endpoint — the payment is the point, not the response.

### 5.4 Dashboard

A read-only Next.js app polling the agent's event/state file:

- **Liquid vs. earning** — two numbers + a bar.
- **Realized yield** — `currentValue − principal`, derived from share price (see §3.3).
- **Runway** — `(liquid + currentValue) / average_burn_per_period`.
- **Event log** — sweeps, withdrawals, payments, each with a tx hash linking to the explorer.

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
| `BUFFER_USDC` | Liquid balance to keep un-swept. |
| `TICK_SECONDS` | Loop interval. |

> Find and verify a vault by inspecting candidate ERC-4626 contracts on the public block
> explorer (`asset()` should return the USDC address; `totalAssets()` should be non-zero). The
> demo does not endorse any specific vault — point it at one you've reviewed.

---

## 7. Testing & Verification

The riskiest part is the on-chain earn leg, so it's verified first and independently:

1. **`verify-earn` script** — against the configured vault on testnet: read `asset()`,
   `decimals()`, `totalAssets()`; deposit a small amount; assert `position()` reflects it;
   withdraw; assert funds return. No HTTP server needed.
2. **Decimals roundtrip test** — deposit X USDC, read back `currentValue`, assert it matches X
   within rounding, proving the shares↔assets conversion (§3.2) is correct.
3. **Loop dry-run** — with a stub `PaymentLeg`, confirm sweep and just-in-time withdrawal fire
   at the right thresholds.
4. **Restart recovery** — kill the agent mid-run, restart, confirm it re-reads on-chain state
   and resumes without double-counting principal.
5. **End-to-end** — fund from the faucet → run the agent → observe a real deposit, a real
   just-in-time withdrawal, and a real payment, each verifiable on the explorer.

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

- **Trivial allocation policy.** Buffer + sweep only. A real treasury would consider gas cost of
  rebalancing, expected burn, multiple vaults, and risk limits.
- **Single vault.** No diversification or APY comparison across sources.
- **Yield reporting is realized-only.** No forward APY projection (deliberate — see §3.3).
- **Withdrawal latency/gas not optimized.** Each just-in-time withdrawal is a transaction; a
  production version would batch or pre-position liquidity.
- **Swappable earn source.** The `EarnProvider` seam means a different yield backend (another
  vault, or a higher-level earn SDK if one becomes available) can replace `MorphoVaultProvider`
  without changing the agent loop.
