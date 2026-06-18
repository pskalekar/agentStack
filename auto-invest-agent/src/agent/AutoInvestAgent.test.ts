import { describe, it, expect } from 'vitest'
import { parseUnits, type Account, type Address, type Hash, type PublicClient } from 'viem'
import { AutoInvestAgent } from './AutoInvestAgent'
import type { EarnProvider, VaultPosition } from '../earn/types'
import type { PaymentLeg, PaymentResult } from '../pay/types'

const U = (s: string) => parseUnits(s, 6) // USDC base units

// Shared mutable chain state the fakes read/write — mirrors how the real
// EarnProvider/PaymentLeg/balanceOf all touch the same on-chain balance.
type Chain = { liquid: bigint; vault: bigint }

class FakeVault implements EarnProvider {
  constructor(private c: Chain) {}
  async deposit(a: bigint) { this.c.liquid -= a; this.c.vault += a; return { txHash: '0xdeposit' as Hash } }
  async withdraw(a: bigint) { this.c.vault -= a; this.c.liquid += a; return { txHash: '0xwithdraw' as Hash } }
  async maxWithdraw() { return this.c.vault }
  async position(): Promise<VaultPosition> { return { shares: this.c.vault, currentValue: this.c.vault } }
}

class FakePay implements PaymentLeg {
  payments: bigint[] = []
  constructor(private c: Chain) {}
  async pay(a: bigint): Promise<PaymentResult> {
    this.c.liquid -= a
    this.payments.push(a)
    return { txHash: '0xpay' as Hash, paidUSDC: a, to: '0xpayee' as Address }
  }
}

function makeAgent(c: Chain, opts?: { buffer?: string; lowWater?: string; gasReserve?: string }) {
  const pub = { readContract: async () => c.liquid } as unknown as PublicClient
  const account = { address: '0xagent' } as unknown as Account
  const earn = new FakeVault(c)
  const pay = new FakePay(c)
  const agent = new AutoInvestAgent({
    publicClient: pub,
    account,
    usdcAddress: '0xusdc' as Address,
    earn,
    pay,
    bufferUSDC: U(opts?.buffer ?? '1.1'),
    lowWaterUSDC: U(opts?.lowWater ?? '0.55'),
    gasReserveUSDC: U(opts?.gasReserve ?? '0.01'),
  })
  return { agent, earn, pay, c }
}

describe('AutoInvestAgent.sweepIdle', () => {
  it('invests everything above the buffer', async () => {
    const { agent, c } = makeAgent({ liquid: U('5'), vault: 0n })
    const r = await agent.sweepIdle()
    expect(r.swept).toBe(U('3.9')) // 5 - 1.1 buffer
    expect(c.liquid).toBe(U('1.1'))
    expect(c.vault).toBe(U('3.9'))
  })

  it('is a no-op when liquid is below the buffer', async () => {
    const { agent, c } = makeAgent({ liquid: U('0.5'), vault: 0n })
    const r = await agent.sweepIdle()
    expect(r.swept).toBe(0n)
    expect(r.txHash).toBeUndefined()
    expect(c.liquid).toBe(U('0.5'))
  })

  it('is a no-op when liquid exactly equals the buffer (boundary)', async () => {
    const { agent, c } = makeAgent({ liquid: U('1.1'), vault: 0n })
    const r = await agent.sweepIdle()
    expect(r.swept).toBe(0n)
    expect(c.vault).toBe(0n)
  })
})

describe('AutoInvestAgent.payForTask', () => {
  it('pays from the buffer without refilling when liquid >= low-water', async () => {
    const { agent, c } = makeAgent({ liquid: U('1.1'), vault: U('10') })
    const r = await agent.payForTask(U('0.1'))
    expect(r.refilled).toBe(0n)
    expect(r.payment.paidUSDC).toBe(U('0.1'))
    expect(c.liquid).toBe(U('1.0'))
    expect(c.vault).toBe(U('10')) // untouched
  })

  it('does NOT refill when liquid exactly equals low-water (trigger is strict <)', async () => {
    const { agent, c } = makeAgent({ liquid: U('0.55'), vault: U('10') })
    const r = await agent.payForTask(U('0.1'))
    expect(r.refilled).toBe(0n)
    expect(c.liquid).toBe(U('0.45'))
  })

  it('refills back up to the buffer when liquid drops below low-water', async () => {
    const { agent, c } = makeAgent({ liquid: U('0.5'), vault: U('10') }) // 0.5 < 0.55
    const r = await agent.payForTask(U('0.1'))
    expect(r.refilled).toBe(U('0.6')) // 1.1 buffer - 0.5 liquid
    expect(c.liquid).toBe(U('1.0')) // refilled to 1.1, then paid 0.1
    expect(c.vault).toBe(U('9.4'))
  })

  it('caps the refill at what the vault can supply', async () => {
    const { agent, c } = makeAgent({ liquid: U('0.5'), vault: U('0.3') })
    const r = await agent.payForTask(U('0.1'))
    expect(r.refilled).toBe(U('0.3')) // only 0.3 available, not the full 0.6 needed
    expect(c.vault).toBe(0n)
    expect(c.liquid).toBe(U('0.7')) // 0.5 + 0.3 - 0.1
  })

  it('pays the EXACT cost, never the whole balance', async () => {
    const { agent, c } = makeAgent({ liquid: U('1.1'), vault: 0n })
    await agent.payForTask(U('0.1'))
    expect(c.liquid).toBe(U('1.0')) // kept the rest
  })

  // Isolates the gas reserve: liquid sits between cost and cost+gasReserve, vault
  // dry so no refill. Must throw *because of* the reserve.
  it('throws when liquid covers the cost but not cost + gas reserve', async () => {
    const { agent } = makeAgent({ liquid: U('0.105'), vault: 0n }) // 0.1 < 0.105 < 0.11
    await expect(agent.payForTask(U('0.1'))).rejects.toThrow(/cannot cover/i)
  })

  it('with a zero gas reserve, the same balance CAN pay (proves the reserve mattered)', async () => {
    const { agent, c } = makeAgent({ liquid: U('0.105'), vault: 0n }, { gasReserve: '0' })
    const r = await agent.payForTask(U('0.1'))
    expect(r.payment.paidUSDC).toBe(U('0.1'))
    expect(c.liquid).toBe(U('0.005'))
  })
})

describe('AutoInvestAgent multi-task cadence (invariants, not magic numbers)', () => {
  it('refills only when below low-water, never overspends, and not every task', async () => {
    const lowWater = U('0.55')
    const { agent, pay, c } = makeAgent({ liquid: 0n, vault: U('100') })
    let refills = 0
    for (let i = 0; i < 12; i++) {
      const pre = c.liquid
      const r = await agent.payForTask(U('0.1'))
      if (r.refilled > 0n) {
        refills++
        expect(pre).toBeLessThan(lowWater) // refilled ⟹ was below low-water
      } else {
        expect(pre).toBeGreaterThanOrEqual(lowWater) // didn't refill ⟹ had enough
      }
      expect(c.liquid).toBeGreaterThanOrEqual(0n) // never overspends
    }
    expect(pay.payments).toHaveLength(12) // all tasks paid
    expect(refills).toBeGreaterThan(0)
    expect(refills).toBeLessThan(12) // redeeming is the exception, not every task
  })
})
