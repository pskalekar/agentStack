import type { Account, Address, Hash, PublicClient } from 'viem'
import { erc20Abi } from '../abi/erc20'
import type { EarnProvider } from '../earn/types'
import type { PaymentLeg, PaymentResult } from '../pay/types'

export interface AutoInvestAgentOpts {
  publicClient: PublicClient
  account: Account
  usdcAddress: Address
  earn: EarnProvider
  pay: PaymentLeg
  /** Liquid USDC to keep un-invested, in base units (6 decimals). */
  bufferUSDC: bigint
  /**
   * USDC to keep on hand for gas, in base units. On Arc, gas is paid in USDC
   * from the same balance, so the agent must never spend down to zero — it
   * always retains this much to cover the next transaction's fee.
   */
  gasReserveUSDC: bigint
}

export interface Snapshot {
  liquid: bigint   // wallet USDC, base units
  invested: bigint // current value of the vault position, base units
  shares: bigint   // vault shares (vault decimals)
}

export interface PayForTaskResult {
  withdrew: bigint
  withdrawTx?: Hash
  payment: PaymentResult
}

/**
 * The auto-invest policy: keep a liquid buffer, invest the excess, and pull
 * funds back from the vault just-in-time to cover a payment. Deliberately
 * trivial — the lesson is the composition (earn + pay), not the strategy.
 */
export class AutoInvestAgent {
  private readonly pub: PublicClient
  private readonly account: Account
  private readonly usdc: Address
  private readonly earn: EarnProvider
  private readonly payLeg: PaymentLeg
  private readonly buffer: bigint
  private readonly gasReserve: bigint

  constructor(o: AutoInvestAgentOpts) {
    this.pub = o.publicClient
    this.account = o.account
    this.usdc = o.usdcAddress
    this.earn = o.earn
    this.payLeg = o.pay
    this.buffer = o.bufferUSDC
    this.gasReserve = o.gasReserveUSDC
  }

  async liquid(): Promise<bigint> {
    return this.pub.readContract({
      address: this.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [this.account.address],
    })
  }

  async snapshot(): Promise<Snapshot> {
    const [liquid, position] = await Promise.all([this.liquid(), this.earn.position()])
    return { liquid, invested: position.currentValue, shares: position.shares }
  }

  /** Invest any liquid USDC above the buffer. No-op if at or below buffer. */
  async sweepIdle(): Promise<{ swept: bigint; txHash?: Hash }> {
    const liquid = await this.liquid()
    if (liquid <= this.buffer) return { swept: 0n }
    const excess = liquid - this.buffer
    const { txHash } = await this.earn.deposit(excess)
    return { swept: excess, txHash }
  }

  /**
   * Pay `costUSDC` for a task. The agent wants `cost + gasReserve` liquid before
   * paying (so it can pay the full amount AND afford gas — gas is USDC on Arc).
   * If short, it withdraws the difference from the vault (capped at what's
   * actually withdrawable). It pays the EXACT cost — never the whole balance —
   * and throws if it genuinely cannot cover the cost.
   */
  async payForTask(costUSDC: bigint, memo?: string): Promise<PayForTaskResult> {
    const target = costUSDC + this.gasReserve
    let liquid = await this.liquid()
    let withdrew = 0n
    let withdrawTx: Hash | undefined

    if (liquid < target) {
      const shortfall = target - liquid
      const available = await this.earn.maxWithdraw()
      const toWithdraw = shortfall < available ? shortfall : available
      if (toWithdraw > 0n) {
        const res = await this.earn.withdraw(toWithdraw)
        withdrew = toWithdraw
        withdrawTx = res.txHash
        liquid = await this.liquid()
      }
    }

    if (liquid < costUSDC) {
      throw new Error(
        `Cannot cover task: need ${costUSDC} (base units) liquid but only have ${liquid}; ` +
        `the vault could not supply the rest (maxWithdraw exhausted).`,
      )
    }

    // Pay exactly the cost; the gas reserve stays behind to fund the tx fee.
    const payment = await this.payLeg.pay(costUSDC, memo)
    return { withdrew, withdrawTx, payment }
  }
}
