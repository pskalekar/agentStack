import { describe, it, expect } from 'vitest'
import { parseUnits, type Address, type Hash } from 'viem'
import { runTick, type TickAgent } from './runTick'
import type { PayForTaskResult } from './AutoInvestAgent'
import type { AgentEvent } from '../events'

const U = (s: string) => parseUnits(s, 6)

function stubAgent(opts?: { swept?: bigint; task?: PayForTaskResult; failTask?: boolean }) {
  const calls = { sweep: 0, pay: 0 }
  const agent: TickAgent = {
    async sweepIdle() {
      calls.sweep++
      return { swept: opts?.swept ?? 0n, txHash: '0xsweep' as Hash }
    },
    async payForTask(costUSDC) {
      calls.pay++
      if (opts?.failTask) throw new Error('payment reverted')
      return (
        opts?.task ?? {
          refilled: 0n,
          payment: { txHash: '0xpay' as Hash, paidUSDC: costUSDC, to: '0xpayee' as Address },
        }
      )
    },
  }
  return { agent, calls }
}

function recorder() {
  const events: AgentEvent[] = []
  return { emit: (e: AgentEvent) => events.push(e), events }
}

const base = { taskEveryTicks: 3, taskCostUSDC: U('0.1'), now: 1000 }

describe('runTick — pending-tx guard', () => {
  it('skips entirely (no sweep, no task, no events) when a tx is in flight', async () => {
    const { agent, calls } = stubAgent({ swept: U('5') })
    const rec = recorder()
    const r = await runTick({ agent, tick: 3, ...base, pendingTxInFlight: true, emit: rec.emit })
    expect(r.skipped).toBe(true)
    expect(calls.sweep).toBe(0)
    expect(calls.pay).toBe(0)
    expect(rec.events).toEqual([])
  })
})

describe('runTick — sweep + events', () => {
  it('sweeps on a non-cadence tick and emits a sweep event', async () => {
    const { agent, calls } = stubAgent({ swept: U('2') })
    const rec = recorder()
    const r = await runTick({ agent, tick: 1, ...base, pendingTxInFlight: false, emit: rec.emit })
    expect(calls.sweep).toBe(1)
    expect(calls.pay).toBe(0)
    expect(r.task).toBeUndefined()
    expect(rec.events).toEqual([{ type: 'sweep', amountUSDC: '2', txHash: '0xsweep', at: 1000 }])
  })

  it('emits no sweep event when nothing was idle', async () => {
    const { agent } = stubAgent({ swept: 0n })
    const rec = recorder()
    await runTick({ agent, tick: 1, ...base, pendingTxInFlight: false, emit: rec.emit })
    expect(rec.events).toEqual([])
  })
})

describe('runTick — task cadence', () => {
  it('pays + emits pay on a cadence tick', async () => {
    const { agent, calls } = stubAgent()
    const rec = recorder()
    await runTick({ agent, tick: 3, ...base, pendingTxInFlight: false, emit: rec.emit })
    expect(calls.pay).toBe(1)
    expect(rec.events.map((e) => e.type)).toEqual(['pay'])
  })

  it('does not pay on non-cadence ticks', async () => {
    const { agent, calls } = stubAgent()
    const rec = recorder()
    for (const tick of [1, 2, 4, 5]) await runTick({ agent, tick, ...base, pendingTxInFlight: false, emit: rec.emit })
    expect(calls.pay).toBe(0)
    expect(calls.sweep).toBe(4)
  })

  it('never pays when taskEveryTicks is 0', async () => {
    const { agent, calls } = stubAgent()
    const rec = recorder()
    await runTick({ agent, tick: 6, taskEveryTicks: 0, taskCostUSDC: U('0.1'), now: 1000, pendingTxInFlight: false, emit: rec.emit })
    expect(calls.pay).toBe(0)
  })

  it('emits a withdraw event before pay when a refill happened', async () => {
    const task: PayForTaskResult = {
      refilled: U('0.9'),
      refillTx: '0xrefill' as Hash,
      payment: { txHash: '0xpay' as Hash, paidUSDC: U('0.1'), to: '0xpayee' as Address },
    }
    const { agent } = stubAgent({ task })
    const rec = recorder()
    await runTick({ agent, tick: 3, ...base, pendingTxInFlight: false, emit: rec.emit })
    expect(rec.events.map((e) => e.type)).toEqual(['withdraw', 'pay'])
  })
})

describe('runTick — regression: successful sweep is recorded even if the task throws', () => {
  it('emits the sweep event, then propagates the task error', async () => {
    const { agent } = stubAgent({ swept: U('2'), failTask: true })
    const rec = recorder()
    await expect(
      runTick({ agent, tick: 3, ...base, pendingTxInFlight: false, emit: rec.emit }),
    ).rejects.toThrow(/reverted/i)
    expect(rec.events).toEqual([{ type: 'sweep', amountUSDC: '2', txHash: '0xsweep', at: 1000 }])
  })
})
