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
  /** High-water liquid target (the buffer), in base units (6 decimals). */
  bufferUSDC: bigint
  /** Low-water refill trigger, in base units. When liquid drops below this, the
   * agent refills back up to the buffer in one withdrawal. */
  lowWaterUSDC: bigint
  /**
   * USDC to keep on hand for gas, in base units. On Arc, gas is paid in USDC
   * from the same balance, so the agent must never spend down to zero — it
   * always retains this much to cover the next transaction's fee.
   */
  gasReserveUSDC: bigint
  /**
   * Minimum idle amount worth sweeping, in base units. Below this, a deposit's
   * gas would rival the amount invested, so we skip it.
   */
  minSweepUSDC: bigint
}

export interface Snapshot {
  liquid: bigint   // wallet USDC, base units
  invested: bigint // current value of the vault position, base units
  shares: bigint   // vault shares (vault decimals)
}

export interface PayForTaskResult {
  refilled: bigint
  refillTx?: Hash
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
  private readonly lowWater: bigint
  private readonly gasReserve: bigint
  private readonly minSweep: bigint

  constructor(o: AutoInvestAgentOpts) {
    this.pub = o.publicClient
    this.account = o.account
    this.usdc = o.usdcAddress
    this.earn = o.earn
    this.payLeg = o.pay
    this.buffer = o.bufferUSDC
    this.lowWater = o.lowWaterUSDC
    this.gasReserve = o.gasReserveUSDC
    this.minSweep = o.minSweepUSDC
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

  /**
   * Invest liquid USDC above the buffer. No-op if at/below the buffer, or if the
   * excess is below `minSweep` (too small to be worth a deposit tx's gas).
   */
  async sweepIdle(): Promise<{ swept: bigint; txHash?: Hash }> {
    const liquid = await this.liquid()
    const excess = liquid - this.buffer
    if (excess <= 0n || excess < this.minSweep) return { swept: 0n }
    const { txHash } = await this.earn.deposit(excess)
    return { swept: excess, txHash }
  }

  /**
   * Pay `costUSDC` for a task, mostly from the liquid buffer.
   *
   * When liquid drops below the configured low-water (≈ N tasks of cost+gas), the
   * agent refills back up to the BUFFER (high-water) in one withdrawal — so a
   * single redemption covers many subsequent tasks, instead of redeeming every
   * task. Pays the EXACT cost (never the whole balance); keeps a gas reserve so
   * the payment tx can always afford its fee; throws if it genuinely can't cover.
   */
  async payForTask(costUSDC: bigint, memo?: string): Promise<PayForTaskResult> {
    let liquid = await this.liquid()
    let refilled = 0n
    let refillTx: Hash | undefined

    if (liquid < this.lowWater) {
      const need = this.buffer - liquid
      const available = await this.earn.maxWithdraw()
      const toWithdraw = need < available ? need : available
      if (toWithdraw > 0n) {
        const res = await this.earn.withdraw(toWithdraw)
        refilled = toWithdraw
        refillTx = res.txHash
        liquid = await this.liquid()
      }
    }

    if (liquid < costUSDC + this.gasReserve) {
      throw new Error(
        `Cannot cover task: need ${costUSDC} + gas liquid but only have ${liquid}; ` +
        `the vault could not supply the rest (maxWithdraw exhausted).`,
      )
    }

    // Pay exactly the cost; the gas reserve stays behind to fund the tx fee.
    const payment = await this.payLeg.pay(costUSDC, memo)
    return { refilled, refillTx, payment }
  }
}
